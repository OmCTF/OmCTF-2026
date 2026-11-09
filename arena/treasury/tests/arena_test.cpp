#include "arena.hpp"

#include <stdexcept>
#include <string>
#include <vector>

using namespace kazna;
void check(bool condition, const char *reason) { if (!condition) throw std::runtime_error(reason); }

class FixedCommander final : public Commander {
 public:
  FixedCommander(std::vector<Recruit> army, int action, int focus = -1)
      : army_(std::move(army)), action_(action), focus_(focus) {}
  std::vector<Recruit> deploy(int, int, uint64_t, int) override { return army_; }
  std::vector<UnitCommand> decide(const Observation &obs) override {
    std::vector<UnitCommand> orders;
    for (const auto &unit : obs.units) if (unit.friendly) orders.push_back({unit.id, action_, focus_});
    return orders;
  }
 private:
  std::vector<Recruit> army_;
  int action_, focus_;
};

class SiegeCommander final : public Commander {
 public:
  std::vector<Recruit> deploy(int, int, uint64_t, int) override {
    std::vector<Recruit> army;
    for (int i = 0; i < 8; ++i) army.push_back({4, i % 3});
    return army;
  }
  std::vector<UnitCommand> decide(const Observation &obs) override {
    std::vector<UnitCommand> orders;
    for (const auto &unit : obs.units) if (unit.friendly) {
      int distance = std::abs(unit.x - 12) + std::abs(unit.y - 7);
      orders.push_back({unit.id, distance <= 3 ? 4 : 0, -1});
    }
    return orders;
  }
};

bool has_event(const nlohmann::json &trace, const char *kind) {
  for (const auto &event : trace.at("events")) if (event.at("type") == kind) return true;
  return false;
}

uint64_t replay_digest(const nlohmann::json &trace) {
  uint64_t digest = UINT64_C(14695981039346656037);
  for (unsigned char byte : trace.dump()) {
    digest ^= byte;
    digest *= UINT64_C(1099511628211);
  }
  return digest;
}

int main() {
  FixedCommander guessing({{0, 0}}, 2, 1);
  FixedCommander distant_guard({{5, 2}}, 1);
  auto hidden = fight(1, 42, guessing, distant_guard);
  bool held = false;
  for (const auto &event : hidden.trace.at("events")) if (event.at("type") == "move" && event.at("id") == 0) {
    held = event.at("action") == 1; break;
  }
  check(held, "unseen focused target was accepted");
  check(hidden.trace == fight(1, 42, guessing, distant_guard).trace, "battle is not deterministic");
  std::string terrain = hidden.trace.at("terrain").get<std::string>();
  check(terrain.size() == sdk::Width * sdk::Height, "terrain size");
  int bridges = 0, gates = 0;
  for (char tile : terrain) { bridges += tile == '='; gates += tile == '+'; }
  check(bridges == 4 && gates == 3 && terrain[7 * sdk::Width + 12] == '$', "bridges, gates, or vault missing");
  check(terrain != fight(1, 43, guessing, distant_guard).trace.at("terrain").get<std::string>(), "match seed did not change board");
  for (const auto &event : hidden.trace.at("events")) if (event.at("type") == "move") {
    int x = event.at("x"), y = event.at("y");
    check(x >= 0 && x < sdk::Width && y >= 0 && y < sdk::Height, "unit left board");
    check(terrain[y * sdk::Width + x] != '~' && terrain[y * sdk::Width + x] != '#', "unit crossed impassable tile");
  }

  SiegeCommander siege;
  FixedCommander weak_guard({{5, 0}}, 1);
  auto raid = fight(1, 0x19192026, siege, weak_guard);
  check(has_event(raid.trace, "charge_placed"), "sappers never planted charges");
  check(has_event(raid.trace, "charge_detonated"), "charges never detonated");
  check(raid.grade > 0, "siege could not damage weak guard");
  check(raid.trace.at("won") == nlohmann::json::array({raid.grade >= 1, raid.grade >= 2, raid.grade >= 3}), "grade does not award 0-3 flags");

  FixedCommander smoke({{5, 2}}, 10);
  FixedCommander engineers({{9, 2}}, 6);
  auto support = fight(2, 777, smoke, engineers);
  check(has_event(support.trace, "smoke"), "scout smoke missing");
  check(has_event(support.trace, "fortify"), "engineer fortification missing");

  Rules winter;
  winter.turns = 8; winter.weather = 2; winter.terrain_seed = 98765;
  auto changed = fight(4, 42, guessing, distant_guard, winter);
  check(changed.trace.at("round") == 4 && changed.trace.at("weather") == 2 && changed.trace.at("turns") == 8, "announced rules not applied");
  check(changed.trace.at("terrain") != hidden.trace.at("terrain"), "terrain seed did not change board");

  // Golden replays from the original Kazna engine (4ae87875) with the same
  // commanders, rule object, and seed. Compare the entire trace, not just grade.
  check(replay_digest(hidden.trace) == UINT64_C(9421515073476385984), "hidden target replay changed");
  check(replay_digest(raid.trace) == UINT64_C(13865236301761043997), "siege replay changed");
  check(replay_digest(support.trace) == UINT64_C(16119745472793501398), "support replay changed");
  check(replay_digest(changed.trace) == UINT64_C(9877880714085551112), "winter replay changed");
}
