#include "arena.hpp"
#include "strategy.hpp"
#include "vendor/httplib.h"

#include <algorithm>
#include <charconv>
#include <chrono>
#include <cstdlib>
#include <fstream>
#include <string_view>
#include <csignal>
#include <iostream>
#include <memory>
#include <openssl/hmac.h>
#include <semaphore>
#include <stdexcept>

using json = nlohmann::json;

namespace {
void reply(httplib::Response &res, int status, const json &body) {
  res.status = status;
  res.set_content(body.dump(-1, ' ', false, json::error_handler_t::replace), "application/json; charset=utf-8");
  res.set_header("Cache-Control", "no-store");
}

json parse(const httplib::Request &req) {
  auto body = json::parse(req.body, nullptr, false);
  if (body.is_discarded() || !body.is_object()) throw std::invalid_argument("неверный JSON");
  return body;
}

constexpr std::size_t program_limit = 16384;
constexpr std::string_view api_version = "arena/v1";
constexpr std::string_view bundle_version = "1.0.0";

std::string file_content(const std::string &path, std::size_t limit) {
  std::ifstream in(path, std::ios::binary);
  if (!in) throw std::runtime_error("не удалось открыть файл настройки рефери");
  std::string contents(limit + 1, '\0');
  in.read(contents.data(), static_cast<std::streamsize>(contents.size()));
  if (in.bad() || static_cast<std::size_t>(in.gcount()) > limit)
    throw std::runtime_error("неверный размер файла настройки рефери");
  contents.resize(static_cast<std::size_t>(in.gcount()));
  return contents;
}

std::string environment(const char *name, const char *fallback = "") {
  const char *value = std::getenv(name);
  return value ? value : fallback;
}

template<class T> T decimal(std::string_view input, const char *message) {
  T value{};
  const auto [end, error] = std::from_chars(input.data(), input.data() + input.size(), value);
  if (error != std::errc{} || end != input.data() + input.size()) throw std::invalid_argument(message);
  return value;
}

bool authorized(std::string_view actual, std::string_view expected) {
  if (actual.size() != expected.size()) return false;
  unsigned difference = 0;
  for (std::size_t i = 0; i < actual.size(); ++i)
    difference |= static_cast<unsigned char>(actual[i]) ^ static_cast<unsigned char>(expected[i]);
  return difference == 0;
}

std::string program(const json &body, bool optional = false) {
  auto it = body.find("program");
  if (optional && (it == body.end() || it->is_null() || *it == "")) return {};
  if (it == body.end() || !it->is_string()) throw std::invalid_argument("не указана программа");
  const auto &encoded = it->get_ref<const std::string &>();
  constexpr std::string_view alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  if (encoded.empty() || encoded.size() % 4 || encoded.size() > ((program_limit + 2) / 3) * 4)
    throw std::invalid_argument("недопустимый размер программы в base64");
  std::string result;
  result.reserve(encoded.size() / 4 * 3);
  for (std::size_t i = 0; i < encoded.size(); i += 4) {
    const auto a = alphabet.find(encoded[i]);
    const auto b = alphabet.find(encoded[i + 1]);
    const auto c = alphabet.find(encoded[i + 2]);
    const auto d = alphabet.find(encoded[i + 3]);
    if (a == alphabet.npos || b == alphabet.npos) throw std::invalid_argument("неверный base64");
    result.push_back(static_cast<char>((a << 2) | (b >> 4)));
    if (i + 4 == encoded.size() && encoded[i + 2] == '=' && encoded[i + 3] == '=' && (b & 15) == 0) break;
    if (c == alphabet.npos) throw std::invalid_argument("неверный base64");
    result.push_back(static_cast<char>((b << 4) | (c >> 2)));
    if (i + 4 == encoded.size() && encoded[i + 3] == '=' && (c & 3) == 0) break;
    if (d == alphabet.npos) throw std::invalid_argument("неверный base64");
    result.push_back(static_cast<char>((c << 6) | d));
  }
  if (result.empty() || result.size() > program_limit) throw std::invalid_argument("длина исходника C++: от 1 до 16 384 байт");
  return result;
}

int role(const json &body) {
  auto value = body.value("role", "");
  if (value == "raider") return 0;
  if (value == "guard") return 1;
  throw std::invalid_argument("неизвестная роль");
}

kazna::Rules generate_rules(uint64_t seed, int epoch) {
  std::array<unsigned char, 128> stream{};
  const auto key = std::to_string(seed);
  // The platform derives a per-task epoch seed. Expand it into the same
  // HMAC stream and byte positions used by the original rule generator.
  for (int block = 0; block < 4; ++block) {
    const auto message = "kazna-rules-v3:0:" + std::to_string(epoch) + ":" + std::to_string(block);
    unsigned size = 0;
    if (!HMAC(EVP_sha256(), key.data(), static_cast<int>(key.size()),
              reinterpret_cast<const unsigned char *>(message.data()), message.size(), stream.data() + block * 32, &size) || size != 32)
      throw std::runtime_error("не удалось сгенерировать правила Казны");
  }
  auto roll = [&](std::size_t index, int choices) { return ((int(stream[index]) << 8) | stream[index + 1]) % choices; };
  kazna::Rules rules;
  rules.raider_budget = 125 + roll(104, 11);
  rules.guard_budget = 110 + roll(106, 11);
  rules.turns = 16 + roll(108, 5);
  rules.weather = epoch % 3;
  rules.terrain_seed = 0;
  for (std::size_t i = 96; i < 104; ++i) rules.terrain_seed = (rules.terrain_seed << 8) | stream[i];
  rules.supply = 10 + roll(110, 7);
  rules.vault_armor = 1 + roll(112, 3);
  for (std::size_t i = 0; i < kazna::sdk::KindCount; ++i) {
    rules.cost[i] += roll(i * 2, 3) - 1;
    rules.health[i] += roll(24 + i * 2, 5) - 2;
    rules.damage[i] = std::max(1, rules.damage[i] + roll(48 + i * 2, 3) - 1);
    rules.speed[i] = std::max(1, rules.speed[i] + roll(72 + i * 2, 3) - 1);
  }
  return rules;
}

json encode_rules(const kazna::Rules &rules) {
  return {{"cost", rules.cost}, {"health", rules.health}, {"damage", rules.damage}, {"speed", rules.speed},
          {"raider_budget", rules.raider_budget}, {"guard_budget", rules.guard_budget}, {"turns", rules.turns},
          {"weather", rules.weather}, {"terrain_seed", rules.terrain_seed}, {"supply", rules.supply},
          {"vault_armor", rules.vault_armor}, {"thresholds", rules.thresholds}};
}

kazna::Rules parse_rules(const json &body) {
  kazna::Rules rules;
  const auto &value = body.at("rules");
  if (!value.is_object()) throw std::invalid_argument("поле rules должно быть объектом");
  try {
    rules.cost = value.at("cost").get<std::array<int, kazna::sdk::KindCount>>();
    rules.health = value.at("health").get<std::array<int, kazna::sdk::KindCount>>();
    rules.damage = value.at("damage").get<std::array<int, kazna::sdk::KindCount>>();
    rules.speed = value.at("speed").get<std::array<int, kazna::sdk::KindCount>>();
    rules.raider_budget = value.at("raider_budget").get<int>();
    rules.guard_budget = value.at("guard_budget").get<int>();
    rules.turns = value.at("turns").get<int>();
    rules.weather = value.at("weather").get<int>();
    rules.terrain_seed = value.at("terrain_seed").get<uint64_t>();
    rules.supply = value.at("supply").get<int>();
    rules.vault_armor = value.at("vault_armor").get<int>();
    rules.thresholds = value.at("thresholds").get<std::array<int, 3>>();
  } catch (const json::exception &) { throw std::invalid_argument("неверные поля правил"); }
  for (int n : rules.cost) if (n < 3 || n > 30) throw std::invalid_argument("цена бойца вне допустимого диапазона");
  for (int n : rules.health) if (n < 1 || n > 40) throw std::invalid_argument("здоровье бойца вне допустимого диапазона");
  for (int n : rules.damage) if (n < 1 || n > 20) throw std::invalid_argument("урон бойца вне допустимого диапазона");
  for (int n : rules.speed) if (n < 1 || n > 5) throw std::invalid_argument("скорость бойца вне допустимого диапазона");
  if (rules.raider_budget < 70 || rules.raider_budget > 180 || rules.guard_budget < 70 || rules.guard_budget > 180 ||
      rules.turns < 8 || rules.turns > 24 || rules.weather < 0 || rules.weather > 2 ||
      rules.supply < 0 || rules.supply > 30 || rules.vault_armor < 0 || rules.vault_armor > 8 ||
      rules.thresholds[0] < 1 || rules.thresholds[0] >= rules.thresholds[1] ||
      rules.thresholds[1] >= rules.thresholds[2] || rules.thresholds[2] > 100)
    throw std::invalid_argument("параметры правил вне допустимого диапазона");
  return rules;
}

json defender_fault(int round, uint64_t seed) {
  return {{"version", 3}, {"round", round}, {"seed", seed}, {"turns", 0}, {"vault_integrity", 0},
          {"score", 100}, {"grade", 3}, {"won", json::array({true, true, true})},
          {"events", json::array({{{"turn", 0}, {"type", "defender_fault"}}})}};
}
json attacker_fault(int round, uint64_t seed) {
  return {{"version", 3}, {"round", round}, {"seed", seed}, {"turns", 0}, {"vault_integrity", 100},
          {"score", 0}, {"grade", 0}, {"won", json::array({false, false, false})},
          {"events", json::array({{{"turn", 0}, {"type", "attacker_fault"}}})}};
}
json match_result(json replay, int raider_index) {
  const int grade = replay.at("grade").get<int>();
  std::array<int, 2> points{}, captures{};
  points[raider_index] = grade;
  points[1 - raider_index] = 3 - grade;
  captures[raider_index] = grade;
  return {{"points", points}, {"winner", grade > 0 ? raider_index : 1 - raider_index},
          {"captures", captures}, {"replay", std::move(replay)}};
}

json probe(const std::string &source, const std::string &strategy_dir, const kazna::Rules &rules, int side, int round) {
  kazna::CxxStrategy strategy(source, strategy_dir);
  strategy.set_rules(rules);
  auto recruits = strategy.deploy(side, round, 1, side == 0 ? rules.raider_budget : rules.guard_budget);
  if (recruits.empty()) throw kazna::StrategyFault("отряд пуст");
  kazna::Observation obs{1, side, 100, 0, rules.supply, rules.supply, std::string(24 * 16, '.'),
                         {{0, 4, 10, 7, 11, 6, 6, 0, 0, 0, 0, true, false, false}}, rules};
  (void)strategy.decide(obs);
  int spent = 0;
  for (const auto &recruit : recruits) spent += rules.cost[recruit.kind];
  return {{"valid", true}, {"recruits", recruits.size()}, {"spent", spent}};
}

struct Slot {
  std::counting_semaphore<64> *semaphore;
  ~Slot() { if (semaphore) semaphore->release(); }
};
} // namespace

int main() {
  std::signal(SIGPIPE, SIG_IGN);
  try {
    auto token = file_content(environment("ARENA_TOKEN_FILE", "/run/secrets/arena-token"), 1024);
    const auto last = token.find_last_not_of("\r\n");
    if (last == std::string::npos) throw std::runtime_error("пустой файл токена рефери");
    token.resize(last + 1);
    if (std::any_of(token.begin(), token.end(), [](unsigned char c) { return c <= 32 || c >= 127; }))
      throw std::runtime_error("неверный формат токена рефери");
    const std::string expected_auth = "Bearer " + token;
    const auto digest = environment("ARENA_PACKAGE_DIGEST");
    if (!digest.empty() && (digest.size() != 64 || digest.find_first_not_of("0123456789abcdef") != std::string::npos))
      throw std::runtime_error("неверный ARENA_PACKAGE_DIGEST");
    const auto strategy_dir = environment("KAZNA_STRATEGY_DIR", "/app/strategy");
    const auto default_guard = file_content(environment("KAZNA_DEFAULT_GUARD", "/app/defaults/guard.cpp"), program_limit);
    const int port = decimal<int>(environment("ARENA_PORT", "9090"), "неверный ARENA_PORT");
    const int concurrency = decimal<int>(environment("ARENA_MATCH_CONCURRENCY", "4"), "неверный ARENA_MATCH_CONCURRENCY");
    if (port < 1 || port > 65535 || concurrency < 1 || concurrency > 64)
      throw std::invalid_argument("порт или параллельность рефери вне диапазона");
    // Readiness depends on compiler, sandbox support, and the packaged fallback.
    probe(default_guard, strategy_dir, kazna::Rules{}, 1, 1);
    std::counting_semaphore<64> match_slots(concurrency), validation_slots(1);
    httplib::Server server;
    server.new_task_queue = [concurrency] { return new httplib::ThreadPool(concurrency + 4, concurrency + 4, 64); };
    server.set_payload_max_length(128 * 1024);
    server.set_read_timeout(5);
    server.set_write_timeout(5);
    server.Get("/health", [&](const auto &, auto &res) {
      json status = {{"status", "ok"}, {"api_version", api_version}, {"version", bundle_version}};
      if (!digest.empty()) status["package_digest"] = digest;
      reply(res, 200, status);
    });
    auto route = [&](const char *path, std::counting_semaphore<64> *slots, auto handler) {
      server.Post(path, [&, slots, handler](const httplib::Request &req, httplib::Response &res) {
        if (!authorized(req.get_header_value("Authorization"), expected_auth)) {
          reply(res, 403, {{"error", "доступ запрещён"}});
          return;
        }
        if (!digest.empty() && req.get_header_value("X-Arena-Package-Digest") != digest) {
          reply(res, 409, {{"error", "неверная версия пакета Arena"}});
          return;
        }
        if (slots && !slots->try_acquire()) {
          res.set_header("Retry-After", "1");
          reply(res, 503, {{"error", "рефери занят"}});
          return;
        }
        const Slot slot{slots};
        try { reply(res, 200, handler(parse(req))); }
        catch (const std::invalid_argument &error) { reply(res, 422, {{"error", error.what()}}); }
        catch (const json::exception &) { reply(res, 422, {{"error", "неверные поля запроса"}}); }
        catch (const kazna::ExecutorUnavailable &error) {
          std::cerr << "временно недоступна среда Казны: " << error.what() << '\n';
          res.set_header("Retry-After", "1");
          reply(res, 503, {{"error", "среда исполнения временно недоступна"}});
        }
        catch (const std::exception &) {
          std::cerr << "внутренняя ошибка рефери\n";
          reply(res, 500, {{"error", "рефери не смог обработать запрос"}});
        }
      });
    };
    route("/v1/rules", nullptr, [&](const json &body) {
      const int epoch = body.at("epoch").get<int>();
      const int first_round = body.at("first_round").get<int>();
      if (epoch < 0 || first_round < 1) throw std::invalid_argument("неверный срок действия правил");
      const auto config = body.find("config");
      if (config != body.end() && !(config->is_object() && config->empty()) && !config->is_null())
        throw std::invalid_argument("Казна не поддерживает переопределение параметров боя");
      const auto seed = decimal<uint64_t>(body.at("seed").get_ref<const std::string &>(), "неверный seed");
      return json{{"rules", encode_rules(generate_rules(seed, epoch))}};
    });
    route("/v1/validate", &validation_slots, [&](const json &body) {
      const auto source = program(body);
      const auto rules = parse_rules(body);
      const int side = role(body);
      const int round = body.value("round", 1);
      if (round < 1) throw std::invalid_argument("неверный раунд");
      try { return probe(source, strategy_dir, rules, side, round); }
      catch (const kazna::StrategyFault &fault) {
        return json{{"valid", false}, {"diagnostic", std::string(fault.what()).substr(0, 4096)}};
      }
    });
    route("/v1/match", &match_slots, [&](const json &body) {
      const int round = body.at("round").get<int>();
      const auto &match_id = body.at("match_id").get_ref<const std::string &>();
      if (round < 1 || match_id.empty() || match_id.size() > 256) throw std::invalid_argument("неверный матч");
      const auto seed = decimal<uint64_t>(body.at("seed").get_ref<const std::string &>(), "неверный seed");
      const auto rules = parse_rules(body);
      const auto &players = body.at("players");
      if (!players.is_array() || players.size() != 2 || role(players[0]) == role(players[1]))
        throw std::invalid_argument("бой требует налётчика и стража");
      const int raider_index = role(players[0]) == 0 ? 0 : 1;
      const auto raider_source = program(players[raider_index], true);
      auto guard_source = program(players[1 - raider_index], true);
      if (raider_source.empty()) return match_result(attacker_fault(round, seed), raider_index);
      const bool fallback = guard_source.empty();
      if (fallback) guard_source = default_guard;
      try {
        kazna::CxxStrategy raider(raider_source, strategy_dir), guard(guard_source, strategy_dir);
        return match_result(kazna::fight(round, seed, raider, guard, rules).trace, raider_index);
      } catch (const kazna::ProgramFault &fault) {
        if (fault.side() == 1 && fallback) throw std::runtime_error("ошибка стандартной обороны");
        return match_result(fault.side() == 1 ? defender_fault(round, seed) : attacker_fault(round, seed), raider_index);
      } catch (const kazna::BuildFault &) {
        // The controller only runs accepted submissions. Rebuild failure can
        // indicate a broken executor and must be retried as infrastructure.
        throw std::runtime_error("не удалось восстановить подготовленную программу");
      }
    });
    if (!server.listen("0.0.0.0", port)) throw std::runtime_error("рефери не смог открыть порт");
  } catch (const std::exception &error) {
    std::cerr << "Казна не запущена: " << error.what() << '\n';
    return 1;
  }
}
