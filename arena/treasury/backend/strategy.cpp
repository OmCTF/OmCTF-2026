#include "strategy.hpp"

#include <algorithm>
#include <cerrno>
#include <chrono>
#include <linux/audit.h>
#include <csignal>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <poll.h>
#include <sstream>
#include <stdexcept>
#include <system_error>
#include <sys/resource.h>
#include <sys/wait.h>
#include <thread>
#include <unistd.h>
#include <fcntl.h>
#include <linux/filter.h>
#include <linux/landlock.h>
#include <linux/seccomp.h>
#include <stddef.h>
#include <sys/prctl.h>
#include <sys/syscall.h>

namespace fs = std::filesystem;
namespace kazna {
struct CxxStrategy::Compiled {
  std::string directory;
  ~Compiled() {
    if (directory.empty()) return;
    std::error_code ignored;
    fs::remove_all(directory, ignored);
  }
};
std::mutex CxxStrategy::cache_mutex_;
std::unordered_map<std::string, std::shared_ptr<CxxStrategy::Compiled>> CxxStrategy::cache_;
std::deque<std::string> CxxStrategy::cache_order_;
namespace {
[[noreturn]] void executor_error(const char *message, const std::error_code &error) {
  if (error == std::errc::no_space_on_device || error == std::errc::not_enough_memory ||
      error == std::errc::too_many_files_open || error == std::errc::too_many_files_open_in_system ||
      error == std::errc::resource_unavailable_try_again)
    throw ExecutorUnavailable(message);
  throw std::runtime_error(message);
}

[[noreturn]] void executor_error(const char *message, int error) {
  executor_error(message, {error, std::generic_category()});
}

bool limits(rlim_t cpu_seconds, rlim_t memory_bytes, rlim_t file_bytes) {
  rlimit cpu{cpu_seconds, cpu_seconds + 1};
  rlimit memory{memory_bytes, memory_bytes};
  rlimit files{32, 32};
  rlimit output{file_bytes, file_bytes};
  rlimit core{0, 0};
  return setrlimit(RLIMIT_CPU, &cpu) == 0 && setrlimit(RLIMIT_AS, &memory) == 0 &&
         setrlimit(RLIMIT_NOFILE, &files) == 0 && setrlimit(RLIMIT_FSIZE, &output) == 0 &&
         setrlimit(RLIMIT_CORE, &core) == 0;
}

void close_pair(int (&fds)[2]) {
  for (int fd : fds) if (fd >= 0) close(fd);
}

[[noreturn]] void setup_failed(int fd) {
  const char failure = 'E';
  (void)write(fd, &failure, 1);
  _exit(126);
}

void keep_setup_fd(int fd) {
  if (fd != 3 && dup3(fd, 3, O_CLOEXEC) < 0) setup_failed(fd);
  // Landlock requires a newer kernel than close_range. Failing closed here
  // ensures no inherited referee sockets or files reach a program.
  if (syscall(SYS_close_range, 4u, ~0u, 0u) != 0) setup_failed(3);
}

pid_t wait_child(pid_t pid, int *status, int options) {
  pid_t result;
  do { result = waitpid(pid, status, options); } while (result < 0 && errno == EINTR);
  return result;
}

void stop_child(pid_t pid, bool group) {
  if (group) kill(-pid, SIGKILL);
  kill(pid, SIGKILL);
  wait_child(pid, nullptr, 0);
}

void await_exec(int fd, pid_t pid, bool group) {
  pollfd pfd{fd, POLLIN, 0};
  const int ready = poll(&pfd, 1, 3000);
  char message;
  const ssize_t result = ready > 0 ? read(fd, &message, 1) : -1;
  close(fd);
  if (result == 0) return;
  stop_child(pid, group);
  throw std::runtime_error("не удалось настроить песочницу или запустить программу");
}

bool apply_landlock(const std::string &directory, bool compilation = false) {
  constexpr uint64_t handled = LANDLOCK_ACCESS_FS_EXECUTE | LANDLOCK_ACCESS_FS_READ_FILE | LANDLOCK_ACCESS_FS_READ_DIR |
    LANDLOCK_ACCESS_FS_WRITE_FILE | LANDLOCK_ACCESS_FS_REMOVE_DIR | LANDLOCK_ACCESS_FS_REMOVE_FILE |
    LANDLOCK_ACCESS_FS_MAKE_CHAR | LANDLOCK_ACCESS_FS_MAKE_DIR | LANDLOCK_ACCESS_FS_MAKE_REG |
    LANDLOCK_ACCESS_FS_MAKE_SOCK | LANDLOCK_ACCESS_FS_MAKE_FIFO | LANDLOCK_ACCESS_FS_MAKE_BLOCK |
    LANDLOCK_ACCESS_FS_MAKE_SYM;
  landlock_ruleset_attr attr{};
  attr.handled_access_fs = handled;
  int ruleset = int(syscall(SYS_landlock_create_ruleset, &attr, sizeof(attr), 0));
  if (ruleset < 0) return false;
  auto allow = [&](const char *path, bool writable = false) {
    int fd = open(path, O_PATH | O_CLOEXEC);
    if (fd < 0) return false;
    uint64_t access = LANDLOCK_ACCESS_FS_EXECUTE | LANDLOCK_ACCESS_FS_READ_FILE | LANDLOCK_ACCESS_FS_READ_DIR;
    if (writable) access |= LANDLOCK_ACCESS_FS_WRITE_FILE | LANDLOCK_ACCESS_FS_REMOVE_DIR |
      LANDLOCK_ACCESS_FS_REMOVE_FILE | LANDLOCK_ACCESS_FS_MAKE_DIR | LANDLOCK_ACCESS_FS_MAKE_REG;
    landlock_path_beneath_attr rule{access, fd};
    bool good = syscall(SYS_landlock_add_rule, ruleset, LANDLOCK_RULE_PATH_BENEATH, &rule, 0) == 0;
    close(fd);
    return good;
  };
  bool okay = allow(directory.c_str(), compilation) && allow("/lib") && allow("/usr/lib");
  // Debian arm64 has no /lib64 loader directory.
  if (access("/lib64", F_OK) == 0) okay = okay && allow("/lib64");
  if (compilation) okay = okay && allow("/usr/include") && allow("/usr/bin") && allow("/usr/libexec");
  if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0) okay = false;
  if (okay) okay = syscall(SYS_landlock_restrict_self, ruleset, 0) == 0;
  close(ruleset);
  return okay;
}

#if defined(__x86_64__)
constexpr unsigned audit_arch = AUDIT_ARCH_X86_64;
#elif defined(__aarch64__)
constexpr unsigned audit_arch = AUDIT_ARCH_AARCH64;
#else
#error Unsupported sandbox architecture
#endif

bool syscall_filter(bool runtime) {
#define CHECK_ARCH \
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(seccomp_data, arch)), \
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, audit_arch, 1, 0), \
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS), \
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(seccomp_data, nr)), \
    BPF_JUMP(BPF_JMP | BPF_JGE | BPF_K, 0x40000000, 0, 1), \
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS)
#define DENY(call) BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_##call, 0, 1), BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM)
#define ALLOW(call) BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_##call, 0, 1), BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW)
  sock_filter compile_filter[] = {
    CHECK_ARCH,
    DENY(socket), DENY(socketpair), DENY(connect), DENY(bind), DENY(listen), DENY(accept), DENY(accept4),
    DENY(ptrace), DENY(process_vm_readv), DENY(process_vm_writev), DENY(pidfd_getfd),
    DENY(io_uring_setup), DENY(io_uring_enter), DENY(io_uring_register), DENY(bpf),
    DENY(mount), DENY(umount2), DENY(unshare), DENY(setns),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
  };
  // The loader and standard library need only process-local operations. File
  // opens are still restricted by Landlock to the program and its libraries.
  sock_filter runtime_filter[] = {
    CHECK_ARCH,
    ALLOW(execve), ALLOW(read), ALLOW(write), ALLOW(close), ALLOW(readlinkat),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_openat, 0, 4),
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(seccomp_data, args[2])),
    BPF_JUMP(BPF_JMP | BPF_JSET | BPF_K, O_ACCMODE | O_CREAT | O_TRUNC | (O_TMPFILE & ~O_DIRECTORY), 0, 1),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
#ifdef __NR_readlink
    ALLOW(readlink),
#endif
#ifdef __NR_fstat
    ALLOW(fstat),
#endif
#ifdef __NR_newfstatat
    ALLOW(newfstatat),
#endif
#ifdef __NR_statx
    ALLOW(statx),
#endif
    ALLOW(lseek), ALLOW(pread64), ALLOW(getdents64), ALLOW(faccessat),
#ifdef __NR_access
    ALLOW(access),
#endif
#ifdef __NR_faccessat2
    ALLOW(faccessat2),
#endif
    ALLOW(mmap), ALLOW(mprotect), ALLOW(munmap), ALLOW(mremap), ALLOW(madvise), ALLOW(brk),
#ifdef __NR_arch_prctl
    ALLOW(arch_prctl),
#endif
    ALLOW(set_tid_address), ALLOW(set_robust_list), ALLOW(rseq), ALLOW(futex),
    ALLOW(rt_sigaction), ALLOW(rt_sigprocmask), ALLOW(rt_sigreturn), ALLOW(sigaltstack),
    ALLOW(getrandom), ALLOW(clock_gettime), ALLOW(getpid), ALLOW(gettid),
    ALLOW(prctl), ALLOW(exit), ALLOW(exit_group),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM),
  };
#undef ALLOW
#undef DENY
#undef CHECK_ARCH
  sock_fprog program = runtime
    ? sock_fprog{static_cast<unsigned short>(sizeof(runtime_filter) / sizeof(runtime_filter[0])), runtime_filter}
    : sock_fprog{static_cast<unsigned short>(sizeof(compile_filter) / sizeof(compile_filter[0])), compile_filter};
  return prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &program) == 0;
}

std::string diagnostic(const fs::path &path) {
  std::ifstream in(path);
  std::string text(4096, '\0');
  in.read(text.data(), text.size());
  text.resize(size_t(in.gcount()));
  return text;
}
} // namespace

CxxStrategy::CxxStrategy(const std::string &source, const std::string &template_dir) {
  if (source.empty() || source.size() > 16384) throw BuildFault("длина программы C++: от 1 до 16 384 байт");
  {
    std::lock_guard lock(cache_mutex_);
    if (auto cached = cache_.find(source); cached != cache_.end()) compiled_ = cached->second;
  }
  if (!compiled_) {
    auto artifact = std::make_shared<Compiled>();
    char path[] = "/tmp/kazna-strategy-XXXXXX";
    if (!mkdtemp(path)) executor_error("не удалось создать каталог для программы", errno);
    artifact->directory = directory_ = path;
    for (const char *file : {"kazna.hpp", "runner.cpp"}) {
      std::error_code error;
      fs::copy_file(fs::path(template_dir) / file, fs::path(directory_) / file, error);
      if (error) executor_error("не удалось скопировать файл среды сборки", error);
    }
    errno = 0;
    std::ofstream out(fs::path(directory_) / "user.cpp", std::ios::binary);
    if (!out) executor_error("не удалось открыть файл исходного кода", errno);
    out << source;
    if (!out) executor_error("не удалось записать исходный код", errno);
    out.close();
    if (!out) executor_error("не удалось записать исходный код", errno);
    compile();
    for (const char *file : {"kazna.hpp", "runner.cpp", "user.cpp", "compile.log"})
      fs::remove(fs::path(directory_) / file);
    // Compiling different source versions never holds the global cache lock.
    std::lock_guard lock(cache_mutex_);
    const auto [entry, inserted] = cache_.try_emplace(source, artifact);
    compiled_ = entry->second;
    if (inserted) cache_order_.push_back(source);
    while (cache_order_.size() > 96) {
      cache_.erase(cache_order_.front());
      cache_order_.pop_front();
    }
  }
  directory_ = compiled_->directory;
  launch();
}

void CxxStrategy::compile() {
  const auto log = fs::path(directory_) / "compile.log";
  const std::string tmp = "TMPDIR=" + directory_;
  const char *args[] = {"g++", "-std=c++20", "-O0", "-pipe", "-fstack-protector-strong", "-I.", "-o", "bot", "runner.cpp", "user.cpp", nullptr};
  const char *environment[] = {"PATH=/usr/bin:/bin", "LANG=C", tmp.c_str(), nullptr};
  int setup[2];
  if (pipe2(setup, O_CLOEXEC) != 0) executor_error("не удалось создать канал сборки", errno);
  const pid_t pid = fork();
  if (pid < 0) {
    const int error = errno;
    close_pair(setup);
    executor_error("не удалось создать процесс", error);
  }
  if (pid == 0) {
    int fd = open(log.c_str(), O_CREAT | O_TRUNC | O_WRONLY, 0600);
    if (fd < 0 || dup2(fd, STDOUT_FILENO) < 0 || dup2(fd, STDERR_FILENO) < 0 || setpgid(0, 0) != 0)
      setup_failed(setup[1]);
    keep_setup_fd(setup[1]);
    if (chdir(directory_.c_str()) != 0 || !limits(10, 2ull * 1024 * 1024 * 1024, 1024ull * 1024) ||
        !apply_landlock(directory_, true) || !syscall_filter(false)) setup_failed(3);
    execve("/usr/bin/g++", const_cast<char *const *>(args), const_cast<char *const *>(environment));
    setup_failed(3);
  }
  close(setup[1]);
  await_exec(setup[0], pid, true);
  int status = 0;
  const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(12);
  pid_t result;
  while ((result = wait_child(pid, &status, WNOHANG)) == 0) {
    if (std::chrono::steady_clock::now() >= deadline) {
      stop_child(pid, true);
      throw BuildFault("время компиляции C++ истекло");
    }
    std::this_thread::sleep_for(std::chrono::milliseconds(10));
  }
  if (result < 0 || (WIFSIGNALED(status) && WTERMSIG(status) == SIGKILL))
    throw std::runtime_error("сборка завершилась с инфраструктурной ошибкой");
  if (!WIFEXITED(status) || WEXITSTATUS(status) != 0) throw BuildFault("ошибка компиляции C++: " + diagnostic(log));
}

void CxxStrategy::launch() {
  const std::string executable = directory_ + "/bot";
  const char *args[] = {executable.c_str(), nullptr};
  const char *environment[] = {"LANG=C", nullptr};
  int input_pipe[2] = {-1, -1}, output_pipe[2] = {-1, -1}, setup[2] = {-1, -1};
  if (pipe2(input_pipe, O_CLOEXEC) || pipe2(output_pipe, O_CLOEXEC) || pipe2(setup, O_CLOEXEC)) {
    const int error = errno;
    close_pair(input_pipe); close_pair(output_pipe); close_pair(setup);
    executor_error("не удалось открыть канал программы", error);
  }
  const pid_t pid = fork();
  if (pid < 0) {
    const int error = errno;
    close_pair(input_pipe); close_pair(output_pipe); close_pair(setup);
    executor_error("не удалось запустить программу", error);
  }
  if (pid == 0) {
    const int nullfd = open("/dev/null", O_WRONLY);
    if (nullfd < 0 || dup2(input_pipe[0], STDIN_FILENO) < 0 || dup2(output_pipe[1], STDOUT_FILENO) < 0 ||
        dup2(nullfd, STDERR_FILENO) < 0) setup_failed(setup[1]);
    keep_setup_fd(setup[1]);
    if (!limits(2, 192ull * 1024 * 1024, 1024 * 1024) || !apply_landlock(directory_) ||
        !syscall_filter(true)) setup_failed(3);
    execve(executable.c_str(), const_cast<char *const *>(args), const_cast<char *const *>(environment));
    setup_failed(3);
  }
  close(setup[1]); close(input_pipe[0]); close(output_pipe[1]);
  try {
    await_exec(setup[0], pid, false);
    for (int fd : {input_pipe[1], output_pipe[0]}) {
      const int flags = fcntl(fd, F_GETFL);
      if (flags < 0 || fcntl(fd, F_SETFL, flags | O_NONBLOCK) != 0) {
        stop_child(pid, false);
        throw std::runtime_error("не удалось настроить неблокирующий канал программы");
      }
    }
  } catch (...) {
    close(input_pipe[1]); close(output_pipe[0]);
    throw;
  }
  input_ = input_pipe[1]; output_ = output_pipe[0]; child_ = pid;
}

std::string CxxStrategy::exchange(const std::string &command) {
  const auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(120);
  auto ready = [&](int fd, short events) {
    for (;;) {
      const auto remaining = std::chrono::ceil<std::chrono::milliseconds>(deadline - std::chrono::steady_clock::now()).count();
      if (remaining <= 0) throw StrategyFault("программа C++ не ответила за 120 мс");
      pollfd descriptor{fd, events, 0};
      const int result = poll(&descriptor, 1, static_cast<int>(remaining));
      if (result == 0) throw StrategyFault("программа C++ не ответила за 120 мс");
      if (result < 0) {
        if (errno == EINTR) continue;
        throw std::runtime_error("ошибка ожидания программы C++");
      }
      if (descriptor.revents & events) return;
      if (descriptor.revents & (POLLERR | POLLHUP)) break;
      throw std::runtime_error("ошибка канала программы C++");
    }
    int status = 0;
    if (wait_child(child_, &status, WNOHANG) == child_) {
      child_ = -1;
      if (WIFSIGNALED(status) && WTERMSIG(status) == SIGKILL)
        throw std::runtime_error("процесс программы C++ был остановлен инфраструктурой");
    }
    throw StrategyFault("программа C++ завершилась до ответа");
  };
  std::size_t sent = 0;
  while (sent < command.size()) {
    ready(input_, POLLOUT);
    const ssize_t n = write(input_, command.data() + sent, command.size() - sent);
    if (n > 0) sent += static_cast<std::size_t>(n);
    else if (n < 0 && errno == EPIPE) throw StrategyFault("программа C++ закрыла входной канал");
    else if (n < 0 && errno != EAGAIN && errno != EINTR) throw std::runtime_error("ошибка записи в канал программы");
  }
  std::string line;
  for (;;) {
    ready(output_, POLLIN);
    char ch;
    const ssize_t n = read(output_, &ch, 1);
    if (n < 0 && (errno == EAGAIN || errno == EINTR)) continue;
    if (n < 0) throw std::runtime_error("ошибка чтения канала программы");
    if (n == 0) throw StrategyFault("программа C++ завершилась до ответа");
    if (ch == '\n') return line;
    if (line.size() >= 4096) throw StrategyFault("ответ программы C++ слишком длинный");
    line.push_back(ch);
  }
}

void CxxStrategy::append_rules(std::ostringstream &out) const {
  for (const auto *array : {&rules_.cost, &rules_.health, &rules_.damage, &rules_.speed})
    for (int value : *array) out << ' ' << value;
  out << ' ' << rules_.raider_budget << ' ' << rules_.guard_budget << ' ' << rules_.turns << ' ' << rules_.weather
      << ' ' << rules_.terrain_seed << ' ' << rules_.supply << ' ' << rules_.vault_armor;
  for (int value : rules_.thresholds) out << ' ' << value;
}

std::vector<Recruit> CxxStrategy::deploy(int side, int round, uint64_t seed, int budget) {
  std::ostringstream request;
  request << "D " << side << ' ' << round << ' ' << seed << ' ' << budget;
  append_rules(request);
  request << '\n';
  std::istringstream parsed(exchange(request.str()));
  char tag = 0;
  int count = -1;
  if (!(parsed >> tag >> count) || tag != 'R' || count < 0 || count > sdk::MaxArmy) throw StrategyFault("программа C++ неверно набрала отряд");
  std::vector<Recruit> recruits;
  int spent = 0;
  for (int i = 0; i < count; ++i) {
    Recruit unit{};
    if (!(parsed >> unit.kind >> unit.post) || unit.kind < 0 || unit.kind >= sdk::KindCount || unit.post < 0 || unit.post > 2)
      throw StrategyFault("в отряде C++ есть недопустимый боец");
    spent += rules_.cost[unit.kind];
    recruits.push_back(unit);
  }
  if (spent > budget) throw StrategyFault("отряд C++ превышает бюджет");
  std::string extra;
  if (parsed >> extra) throw StrategyFault("лишние данные после списка бойцов C++");
  return recruits;
}

std::vector<UnitCommand> CxxStrategy::decide(const Observation &obs) {
  std::ostringstream request;
  request << "T " << obs.turn << ' ' << obs.side << ' ' << obs.vault_integrity << ' ' << obs.vault_control
          << ' ' << obs.own_supply << ' ' << obs.enemy_supply << ' ' << obs.units.size();
  for (const auto &u : obs.units)
    request << ' ' << u.id << ' ' << int(u.friendly) << ' ' << u.kind << ' ' << u.x << ' ' << u.y << ' ' << u.hp
            << ' ' << u.stamina << ' ' << u.morale << ' ' << u.ammo << ' ' << u.cooldown << ' ' << u.shield
            << ' ' << u.suppressed << ' ' << int(u.carrying) << ' ' << int(u.entrenched);
  request << ' ' << obs.terrain;
  append_rules(request);
  request << '\n';
  std::istringstream parsed(exchange(request.str()));
  char tag = 0;
  int count = -1;
  if (!(parsed >> tag >> count) || tag != 'C' || count < 0 || count > 64) throw StrategyFault("неверный ответ программы C++");
  std::vector<UnitCommand> result;
  for (int i = 0; i < count; ++i) {
    UnitCommand unit{};
    if (!(parsed >> unit.id >> unit.action >> unit.target >> unit.target_x >> unit.target_y)) throw StrategyFault("ответ программы C++ оборвался");
    result.push_back(unit);
  }
  std::string extra;
  if (parsed >> extra) throw StrategyFault("лишние данные после приказов C++");
  return result;
}

CxxStrategy::~CxxStrategy() {
  if (input_ >= 0) close(input_);
  if (output_ >= 0) close(output_);
  if (child_ > 0) stop_child(child_, false);
}

} // namespace kazna
