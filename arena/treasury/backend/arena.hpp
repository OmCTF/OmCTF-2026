#pragma once

#include "vendor/json.hpp"
#include "kazna.hpp"

#include <cstdint>
#include <stdexcept>
#include <string>
#include <vector>

namespace kazna {

using Rules = sdk::Rules;

struct Recruit { int kind, post; };
struct SeenUnit {
  int id, kind, x, y, hp, stamina, morale, ammo, cooldown, shield, suppressed;
  bool friendly, carrying, entrenched;
};
struct Observation {
  int turn, side, vault_integrity, vault_control, own_supply, enemy_supply;
  std::string terrain;
  std::vector<SeenUnit> units;
  Rules rules;
};
struct UnitCommand { int id, action, target, target_x = -1, target_y = -1; };

class Commander {
 public:
  virtual ~Commander() = default;
  virtual void set_rules(const Rules &) {}
  virtual std::vector<Recruit> deploy(int side, int round, uint64_t seed, int budget) = 0;
  virtual std::vector<UnitCommand> decide(const Observation &observation) = 0;
};

class StrategyFault : public std::invalid_argument {
 public:
  using std::invalid_argument::invalid_argument;
};

class BuildFault : public StrategyFault {
 public:
  using StrategyFault::StrategyFault;
};

class ProgramFault : public std::runtime_error {
 public:
  ProgramFault(int side, const std::string &message) : std::runtime_error(message), side_(side) {}
  int side() const { return side_; }
 private:
  int side_;
};

struct ArenaResult {
  int grade = 0;
  int score = 0;
  nlohmann::json trace;
};

ArenaResult fight(int round, uint64_t seed, Commander &raider, Commander &guard, const Rules &rules = Rules{});

} // namespace kazna
