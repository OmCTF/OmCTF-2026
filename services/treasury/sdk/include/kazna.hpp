#pragma once

#include <algorithm>
#include <array>
#include <cstdlib>
#include <string>
#include <utility>
#include <vector>

namespace kazna::sdk {

enum class Side : int { Raider = 0, Guard = 1 };
enum class Kind : int {
  Blade = 0, Shield, Archer, Rider, Sapper, Scout,
  Pike, Crossbow, Medic, Engineer, Alchemist, Herald
};
enum class Action : int {
  Advance = 0, Hold, Focus, Retreat, Breach, Scout,
  Fortify, Repair, Heal, Suppress, Smoke, Rally, Dash, PlantMine
};
inline constexpr int KindCount = 12, MaxArmy = 20, Width = 24, Height = 16;

struct Rules {
  std::array<int, KindCount> cost{7, 10, 9, 13, 12, 7, 8, 11, 10, 11, 13, 9};
  std::array<int, KindCount> health{12, 18, 9, 12, 11, 8, 14, 9, 10, 12, 9, 10};
  std::array<int, KindCount> damage{4, 2, 4, 5, 2, 2, 4, 6, 1, 2, 3, 2};
  std::array<int, KindCount> speed{2, 1, 2, 3, 2, 3, 1, 1, 2, 2, 2, 2};
  int raider_budget = 130;
  int guard_budget = 115;
  int turns = 18;
  int weather = 0;
  unsigned long long terrain_seed = 1;
  int supply = 12;
  int vault_armor = 2;
  std::array<int, 3> thresholds{25, 50, 75};
};

struct Recruit { Kind kind; int post; };
struct Unit {
  int id = -1;
  bool friendly = false;
  Kind kind = Kind::Blade;
  int x = 0, y = 0, hp = 0, stamina = 0, morale = 0, ammo = 0,
      cooldown = 0, shield = 0, suppressed = 0;
  bool carrying = false, entrenched = false;
};
struct Command { int unit_id; Action action; int target_id = -1; int target_x = -1, target_y = -1; };
struct DeploymentContext { Side side; int round; unsigned long long seed; int budget; Rules rules; };
struct Observation {
  int turn = 0;
  Side side = Side::Raider;
  int vault_integrity = 100, vault_control = 0, own_supply = 0, enemy_supply = 0;
  std::string terrain;
  std::vector<Unit> units;
  Rules rules;
  char tile(int x, int y) const {
    if (x < 0 || x >= Width || y < 0 || y >= Height || terrain.size() != Width * Height) return '?';
    return terrain[y * Width + x];
  }
};

class Army {
 public:
  explicit Army(const DeploymentContext &context) : budget_(context.budget), rules_(context.rules) {}
  bool add(Kind kind, int post) {
    int index = static_cast<int>(kind);
    if (index < 0 || index >= KindCount || post < 0 || post >= 3 || recruits_.size() >= MaxArmy ||
        spent_ + rules_.cost[index] > budget_) return false;
    spent_ += rules_.cost[index];
    recruits_.push_back({kind, post});
    return true;
  }
  int spent() const { return spent_; }
  std::vector<Recruit> finish() && { return std::move(recruits_); }
 private:
  int budget_ = 0, spent_ = 0;
  Rules rules_;
  std::vector<Recruit> recruits_;
};

inline const Unit *nearest_enemy(const Unit &unit, const Observation &observation) {
  const Unit *best = nullptr;
  int distance = 1000000;
  for (const auto &other : observation.units) {
    if (other.friendly || other.hp <= 0) continue;
    int candidate = std::abs(other.x - unit.x) + std::abs(other.y - unit.y);
    if (candidate < distance) { best = &other; distance = candidate; }
  }
  return best;
}

// Implement both functions in your private strategy.cpp. The jury compiles it.
std::vector<Recruit> deploy(const DeploymentContext &context);
std::vector<Command> decide(const Observation &observation);

} // namespace kazna::sdk
