#include "kazna.hpp"

#include <iostream>
#include <sstream>
#include <string>
#include <cerrno>
#include <linux/filter.h>
#include <linux/seccomp.h>
#include <stddef.h>
#include <sys/prctl.h>
#include <sys/syscall.h>
#include <unistd.h>

namespace {
using namespace kazna::sdk;

bool seal_process() {
#define DENY(call) BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_##call, 0, 1), BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM)
  sock_filter filter[] = {
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(seccomp_data, nr)),
    DENY(socket), DENY(socketpair), DENY(connect), DENY(bind), DENY(listen),
    DENY(execve), DENY(execveat),
    DENY(ptrace), DENY(mount), BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
  };
#undef DENY
  sock_fprog program{static_cast<unsigned short>(sizeof(filter) / sizeof(filter[0])), filter};
  return prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) == 0 &&
         prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &program) == 0;
}

bool read_rules(std::istream &in, Rules &rules) {
  for (auto *values : {&rules.cost, &rules.health, &rules.damage, &rules.speed})
    for (int &value : *values) if (!(in >> value)) return false;
  if (!(in >> rules.raider_budget >> rules.guard_budget >> rules.turns >> rules.weather
           >> rules.terrain_seed >> rules.supply >> rules.vault_armor)) return false;
  for (int &value : rules.thresholds) if (!(in >> value)) return false;
  return true;
}

std::string process(const std::string &line) {
  std::istringstream input(line);
  char type = 0;
  if (!(input >> type)) return "E\n";
  try {
    if (type == 'D') {
      int side = -1;
      DeploymentContext ctx{};
      if (!(input >> side >> ctx.round >> ctx.seed >> ctx.budget) || !read_rules(input, ctx.rules)) return "E\n";
      ctx.side = static_cast<Side>(side);
      auto recruits = deploy(ctx);
      std::ostringstream output;
      output << "R " << recruits.size();
      for (auto recruit : recruits) output << ' ' << static_cast<int>(recruit.kind) << ' ' << recruit.post;
      output << '\n';
      return output.str();
    }
    if (type == 'T') {
      int side = -1, count = -1;
      Observation observation{};
      if (!(input >> observation.turn >> side >> observation.vault_integrity >> observation.vault_control
                  >> observation.own_supply >> observation.enemy_supply >> count) || count < 0 || count > 64) return "E\n";
      observation.side = static_cast<Side>(side);
      for (int i = 0; i < count; ++i) {
        int friendly = 0, kind = 0, carrying = 0, entrenched = 0;
        Unit unit{};
        if (!(input >> unit.id >> friendly >> kind >> unit.x >> unit.y >> unit.hp >> unit.stamina
                    >> unit.morale >> unit.ammo >> unit.cooldown >> unit.shield >> unit.suppressed
                    >> carrying >> entrenched)) return "E\n";
        unit.friendly = friendly != 0;
        unit.kind = static_cast<Kind>(kind);
        unit.carrying = carrying != 0;
        unit.entrenched = entrenched != 0;
        observation.units.push_back(unit);
      }
      if (!(input >> observation.terrain) || observation.terrain.size() != Width * Height) return "E\n";
      if (!read_rules(input, observation.rules)) return "E\n";
      auto commands = decide(observation);
      std::ostringstream output;
      output << "C " << commands.size();
      for (auto command : commands)
        output << ' ' << command.unit_id << ' ' << static_cast<int>(command.action) << ' ' << command.target_id
               << ' ' << command.target_x << ' ' << command.target_y;
      output << '\n';
      return output.str();
    }
  } catch (...) { return "E\n"; }
  return "E\n";
}
} // namespace

static void kazna_preinit() { if (!seal_process()) _exit(127); }
__attribute__((section(".preinit_array"), used)) static void (*const kazna_preinit_hook)() = kazna_preinit;

int main() {
  std::string line;
  while (std::getline(std::cin, line)) std::cout << process(line) << std::flush;
}
