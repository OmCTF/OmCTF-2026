#include "arena.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <limits>
#include <queue>
#include <stdexcept>
#include <unordered_map>
#include <unordered_set>

namespace kazna {
namespace {
using json = nlohmann::json;
constexpr int W = sdk::Width, H = sdk::Height, vault_x = 12, vault_y = 7;
constexpr std::array<std::array<int, 2>, 3> raid_posts = {{{2, 3}, {2, 12}, {21, 12}}};
constexpr std::array<std::array<int, 2>, 3> guard_posts = {{{9, 5}, {15, 5}, {12, 10}}};

struct Unit {
  int id, side, kind, x, y, hp, post;
  int stamina = 6, morale = 6, ammo = -1, cooldown = 0, shield = 0, suppressed = 0;
  bool carrying = false, entrenched = false;
  bool alive() const { return hp > 0; }
};
struct Mine { int x, y, side, ttl; };
struct Smoke { int x, y, ttl; };
struct Charge { int side, ttl, damage; };

int index(int x, int y) { return y * W + x; }
bool inside(int x, int y) { return x >= 0 && x < W && y >= 0 && y < H; }
int distance(int ax, int ay, int bx, int by) { return std::abs(ax - bx) + std::abs(ay - by); }
int distance(const Unit &a, const Unit &b) { return distance(a.x, a.y, b.x, b.y); }
int vault_distance(const Unit &unit) { return distance(unit.x, unit.y, vault_x, vault_y); }
uint64_t mix(uint64_t value) {
  value += 0x9e3779b97f4a7c15ULL;
  value = (value ^ (value >> 30)) * 0xbf58476d1ce4e5b9ULL;
  value = (value ^ (value >> 27)) * 0x94d049bb133111ebULL;
  return value ^ (value >> 31);
}

std::string make_terrain(const Rules &rules, uint64_t match_seed) {
  const uint64_t board_seed = mix(rules.terrain_seed ^ match_seed);
  std::string map(W * H, '.');
  for (int y = 0; y < H; ++y) for (int x = 4; x <= 5; ++x) map[index(x, y)] = '~';
  for (int y : {3 + int(board_seed % 3), 10 + int((board_seed >> 8) % 3)})
    for (int x = 4; x <= 5; ++x) map[index(x, y)] = '=';
  for (int x = 8; x <= 16; ++x) { map[index(x, 3)] = '#'; map[index(x, 11)] = '#'; }
  for (int y = 3; y <= 11; ++y) { map[index(8, y)] = '#'; map[index(16, y)] = '#'; }
  for (const auto &[x, y] : std::array<std::array<int, 2>, 3>{{
      {{8, 5 + int((board_seed >> 16) % 5)}},
      {{16, 5 + int((board_seed >> 24) % 5)}},
      {{10 + int((board_seed >> 32) % 5), 11}}}})
    map[index(x, y)] = '+';
  map[index(vault_x, vault_y)] = '$';
  for (int y = 1; y < H - 1; ++y) for (int x = 1; x < W - 1; ++x) {
    if (map[index(x, y)] != '.' || distance(x, y, vault_x, vault_y) <= 2) continue;
    bool post = false;
    for (const auto &p : raid_posts) if (distance(x, y, p[0], p[1]) <= 1) post = true;
    for (const auto &p : guard_posts) if (distance(x, y, p[0], p[1]) <= 1) post = true;
    if (post) continue;
    uint64_t sample = mix(board_seed ^ uint64_t(index(x, y)) * 0x9e3779b97f4a7c15ULL);
    if (sample % 19 == 0) map[index(x, y)] = '%';
    else if (sample % 13 == 0) map[index(x, y)] = ':';
  }
  return map;
}

bool passable(char tile) { return tile != '~' && tile != '#'; }
int tile_cost(char tile, int weather) {
  int cost = tile == ':' || tile == '%' ? 2 : tile == 'B' ? 3 : 1;
  if (weather == 2 && (tile == ':' || tile == '=')) ++cost;
  return cost;
}

void step_towards(Unit &unit, int target_x, int target_y, int steps, const std::string &terrain, int weather) {
  target_x = std::clamp(target_x, 0, W - 1);
  target_y = std::clamp(target_y, 0, H - 1);
  constexpr int inf = std::numeric_limits<int>::max() / 8;
  for (int step = 0; step < steps; ++step) {
    std::array<int, W * H> costs, first;
    costs.fill(inf); first.fill(-1);
    int origin = index(unit.x, unit.y);
    costs[origin] = 0;
    using Node = std::pair<int, int>;
    std::priority_queue<Node, std::vector<Node>, std::greater<Node>> queue;
    queue.push({0, origin});
    while (!queue.empty()) {
      auto [known, current] = queue.top(); queue.pop();
      if (known != costs[current]) continue;
      int cx = current % W, cy = current / W;
      for (const auto &[dx, dy] : std::array<std::array<int, 2>, 4>{{{{1, 0}}, {{0, 1}}, {{-1, 0}}, {{0, -1}}}}) {
        int nx = cx + dx, ny = cy + dy;
        if (!inside(nx, ny) || !passable(terrain[index(nx, ny)])) continue;
        int next = index(nx, ny), value = known + tile_cost(terrain[next], weather);
        if (value < costs[next]) { costs[next] = value; first[next] = current == origin ? next : first[current]; queue.push({value, next}); }
      }
    }
    int destination = origin, quality = inf;
    for (int candidate = 0; candidate < W * H; ++candidate) if (costs[candidate] < inf) {
      int candidate_quality = distance(candidate % W, candidate / W, target_x, target_y) * 100 + costs[candidate];
      if (candidate_quality < quality) { quality = candidate_quality; destination = candidate; }
    }
    if (destination == origin || first[destination] < 0) break;
    int next = first[destination];
    unit.x = next % W; unit.y = next / W;
    if (terrain[next] == ':' && weather == 2) ++step;
  }
}

bool line_clear(int x0, int y0, int x1, int y1, const std::string &terrain) {
  int dx = std::abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
  int dy = -std::abs(y1 - y0), sy = y0 < y1 ? 1 : -1, error = dx + dy;
  while (x0 != x1 || y0 != y1) {
    int twice = error * 2;
    if (twice >= dy) { error += dy; x0 += sx; }
    if (twice <= dx) { error += dx; y0 += sy; }
    if ((x0 != x1 || y0 != y1) && inside(x0, y0) && terrain[index(x0, y0)] == '#') return false;
  }
  return true;
}

bool in_smoke(int x, int y, const std::vector<Smoke> &zones) {
  for (const auto &zone : zones) if (zone.ttl > 0 && distance(x, y, zone.x, zone.y) <= 3) return true;
  return false;
}
int attack_range(int kind) {
  if (kind == 2) return 5;   // archer
  if (kind == 7) return 6;   // crossbow
  if (kind == 10) return 3;  // alchemist
  if (kind == 3 || kind == 5 || kind == 6) return 2;
  return 1;
}
int counter(int attacker, int defender) {
  if ((attacker == 6 && defender == 3) || (attacker == 3 && defender == 2) ||
      (attacker == 4 && defender == 1) || (attacker == 7 && defender == 1)) return 3;
  if ((attacker == 2 && defender == 0) || (attacker == 5 && defender == 10)) return 2;
  return 0;
}
json event(int turn, const char *type, const Unit &unit, json extra = json::object()) {
  json result = {{"turn", turn}, {"type", type}, {"id", unit.id}, {"side", unit.side ? "guard" : "raider"},
                 {"kind", unit.kind}, {"x", unit.x}, {"y", unit.y}, {"hp", unit.hp},
                 {"stamina", unit.stamina}, {"morale", unit.morale}, {"ammo", unit.ammo},
                 {"cooldown", unit.cooldown}, {"shield", unit.shield}, {"suppressed", unit.suppressed},
                 {"carrying", unit.carrying}, {"entrenched", unit.entrenched}};
  result.update(extra);
  return result;
}
} // namespace

ArenaResult fight(int round, uint64_t seed, Commander &raider, Commander &guard, const Rules &rules) {
  if (round < 1) throw std::invalid_argument("номер раунда должен быть положительным");
  raider.set_rules(rules); guard.set_rules(rules);
  std::vector<Recruit> armies[2];
  try { armies[0] = raider.deploy(0, round, seed, rules.raider_budget); }
  catch (const StrategyFault &error) { throw ProgramFault(0, error.what()); }
  try { armies[1] = guard.deploy(1, round, seed, rules.guard_budget); }
  catch (const StrategyFault &error) { throw ProgramFault(1, error.what()); }
  for (int side = 0; side < 2; ++side) if (armies[side].empty() || armies[side].size() > sdk::MaxArmy)
    throw ProgramFault(side, "недопустимый размер отряда");

  std::string terrain = make_terrain(rules, seed), initial_terrain = terrain;
  std::vector<Unit> units;
  for (int side = 0; side < 2; ++side) {
    int spent = 0;
    for (const auto &recruit : armies[side]) {
      if (recruit.kind < 0 || recruit.kind >= sdk::KindCount || recruit.post < 0 || recruit.post > 2)
        throw ProgramFault(side, "недопустимый боец в отряде");
      spent += rules.cost[recruit.kind];
      if (spent > (side == 0 ? rules.raider_budget : rules.guard_budget)) throw ProgramFault(side, "отряд превышает бюджет");
      const auto &post = side ? guard_posts[recruit.post] : raid_posts[recruit.post];
      int offset = int(units.size()) % 3 - 1;
      Unit unit{int(units.size()), side, recruit.kind, post[0], std::clamp(post[1] + offset, 0, H - 1), rules.health[recruit.kind], recruit.post};
      if (recruit.kind == 2) unit.ammo = 7;
      if (recruit.kind == 7) unit.ammo = 5;
      if (recruit.kind == 10) unit.ammo = 4;
      if (recruit.kind == 1) unit.shield = 2;
      units.push_back(unit);
    }
  }
  int supply[2] = {rules.supply, rules.supply + 2};
  std::vector<Mine> mines;
  std::vector<Smoke> smokes;
  std::vector<Charge> charges;
  int integrity = 100, extractions = 0, loot = 3;
  json events = json::array();
  auto visible = [&](const Unit &observer, const Unit &target) {
    int sight = observer.kind == 5 ? 9 : observer.kind == 7 ? 6 : 5;
    if (rules.weather == 1) sight -= 2;
    if (rules.weather == 2) sight -= 1;
    if (in_smoke(observer.x, observer.y, smokes) || in_smoke(target.x, target.y, smokes)) sight = std::min(sight, 2);
    return distance(observer, target) <= sight && line_clear(observer.x, observer.y, target.x, target.y, terrain);
  };

  for (int turn = 1; turn <= rules.turns; ++turn) {
    for (auto &unit : units) if (unit.alive()) {
      unit.cooldown = std::max(0, unit.cooldown - 1);
      unit.suppressed = std::max(0, unit.suppressed - 1);
    }
    int near[2] = {0, 0};
    for (const auto &unit : units) if (unit.alive() && vault_distance(unit) <= 3) ++near[unit.side];
    auto observation = [&](int side) {
      std::string view = terrain;
      for (const auto &mine : mines) if (mine.side == side) view[index(mine.x, mine.y)] = 'm';
      Observation obs{turn, side, integrity, near[0] - near[1], supply[side], supply[1-side], view, {}, rules};
      for (const auto &unit : units) {
        if (!unit.alive()) continue;
        bool seen = unit.side == side;
        if (!seen) for (const auto &friend_unit : units)
          if (friend_unit.alive() && friend_unit.side == side && visible(friend_unit, unit)) { seen = true; break; }
        if (seen) obs.units.push_back({unit.id, unit.kind, unit.x, unit.y, unit.hp, unit.stamina,
          unit.morale, unit.ammo, unit.cooldown, unit.shield, unit.suppressed,
          unit.side == side, unit.carrying, unit.entrenched});
      }
      return obs;
    };
    std::unordered_map<int, UnitCommand> orders;
    auto collect = [&](Commander &commander, int side) {
      auto obs = observation(side);
      std::vector<UnitCommand> commands;
      try { commands = commander.decide(obs); }
      catch (const StrategyFault &error) { throw ProgramFault(side, error.what()); }
      if (commands.size() > 64) throw ProgramFault(side, "слишком много приказов");
      std::unordered_set<int> visible_enemies;
      for (const auto &unit : obs.units) if (!unit.friendly) visible_enemies.insert(unit.id);
      for (const auto &command : commands) {
        if (command.id < 0 || command.id >= int(units.size()) || units[command.id].side != side ||
            command.action < 0 || command.action > 13) continue;
        if ((command.action == 2 || command.action == 9) && command.target >= 0 && !visible_enemies.contains(command.target)) continue;
        orders[command.id] = command;
      }
    };
    collect(raider, 0); collect(guard, 1);
    auto action_of = [&](const Unit &unit) {
      if (unit.carrying && unit.side == 0) return 3;
      auto it = orders.find(unit.id);
      return it == orders.end() ? 1 : it->second.action;
    };
    auto spend = [&](int side, int amount) {
      if (supply[side] < amount) return false;
      supply[side] -= amount; return true;
    };

    // Movement follows a weighted shortest path through gates and bridges.
    for (auto &unit : units) {
      if (!unit.alive()) continue;
      int action = action_of(unit);
      if (action == 0 || action == 2 || action == 3 || action == 5 || action == 12) {
        int target_x = vault_x, target_y = vault_y;
        const auto &command = orders.contains(unit.id) ? orders.at(unit.id) : UnitCommand{unit.id, action, -1};
        if (action == 3) {
          const auto &post = unit.side ? guard_posts[unit.post] : raid_posts[unit.post];
          target_x = post[0]; target_y = post[1];
        } else if (action == 2 && command.target >= 0 && command.target < int(units.size()) && units[command.target].alive()) {
          target_x = units[command.target].x; target_y = units[command.target].y;
        } else if (inside(command.target_x, command.target_y)) {
          target_x = command.target_x; target_y = command.target_y;
        } else if (unit.side == 1) {
          const Unit *closest = nullptr;
          for (const auto &other : units) if (other.alive() && other.side == 0 && (!closest || distance(unit, other) < distance(unit, *closest))) closest = &other;
          if (closest) { target_x = closest->x; target_y = closest->y; }
        }
        int steps = rules.speed[unit.kind] - (unit.suppressed > 0) - (unit.stamina == 0);
        if (action == 12 && unit.stamina >= 2) steps += 2;
        if (action == 5 && unit.kind == 5) ++steps;
        step_towards(unit, target_x, target_y, std::max(1, steps), terrain, rules.weather);
        unit.stamina = std::max(0, unit.stamina - (action == 12 ? 2 : 1));
        unit.entrenched = false;
      } else unit.stamina = std::min(8, unit.stamina + (action == 1 ? 2 : 1));
      events.push_back(event(turn, "move", unit, {{"action", action}}));
    }

    for (auto &unit : units) if (unit.alive()) for (auto it = mines.begin(); it != mines.end();) {
      if (it->side == unit.side || it->x != unit.x || it->y != unit.y) { ++it; continue; }
      unit.hp -= 7; unit.suppressed = 2;
      events.push_back(event(turn, "mine_trigger", unit, {{"damage", 7}}));
      it = mines.erase(it);
      if (!unit.alive()) { events.push_back(event(turn, "fallen", unit)); break; }
    }

    // Supply and cooldowns make support timing part of each program.
    for (auto &unit : units) {
      if (!unit.alive()) continue;
      int action = action_of(unit);
      if (action == 6 && (unit.kind == 1 || unit.kind == 6 || unit.kind == 9) && spend(unit.side, 1)) {
        unit.entrenched = true; unit.shield = std::min(5, unit.shield + 2);
        if (unit.kind == 9 && terrain[index(unit.x, unit.y)] == '.') terrain[index(unit.x, unit.y)] = 'B';
        events.push_back(event(turn, "fortify", unit));
      } else if (action == 7 && unit.kind == 9 && unit.side == 1 && vault_distance(unit) <= 3 && unit.cooldown == 0 && spend(1, 2)) {
        if (!charges.empty()) { charges.erase(charges.begin()); events.push_back(event(turn, "charge_disarmed", unit)); }
        else { integrity = std::min(100, integrity + 8); events.push_back(event(turn, "repair", unit, {{"integrity", integrity}})); }
        unit.cooldown = 3;
      } else if (action == 8 && unit.kind == 8 && unit.cooldown == 0 && supply[unit.side] >= 1) {
        Unit *patient = nullptr;
        int requested = orders.contains(unit.id) ? orders.at(unit.id).target : -1;
        for (auto &candidate : units) if (candidate.alive() && candidate.side == unit.side &&
            distance(unit, candidate) <= 3 && candidate.hp < rules.health[candidate.kind]) {
          if (candidate.id == requested) { patient = &candidate; break; }
          if (!patient || candidate.hp < patient->hp) patient = &candidate;
        }
        if (patient && spend(unit.side, 1)) {
          patient->hp = std::min(rules.health[patient->kind], patient->hp + 6);
          patient->suppressed = 0; unit.cooldown = 2;
          events.push_back(event(turn, "heal", unit, {{"target", patient->id}, {"hp_after", patient->hp}}));
        }
      } else if (action == 10 && (unit.kind == 5 || unit.kind == 10) && unit.cooldown == 0 && spend(unit.side, 1)) {
        smokes.push_back({unit.x, unit.y, 2}); unit.cooldown = 2;
        events.push_back(event(turn, "smoke", unit));
      } else if (action == 11 && unit.kind == 11 && unit.cooldown == 0 && spend(unit.side, 1)) {
        for (auto &friend_unit : units) if (friend_unit.alive() && friend_unit.side == unit.side && distance(unit, friend_unit) <= 4) {
          friend_unit.morale = std::min(10, friend_unit.morale + 2); friend_unit.suppressed = 0;
        }
        unit.cooldown = 2; events.push_back(event(turn, "rally", unit));
      } else if (action == 13 && (unit.kind == 4 || unit.kind == 9) && unit.cooldown == 0 && supply[unit.side] >= 1) {
        bool occupied = false;
        for (const auto &mine : mines) if (mine.x == unit.x && mine.y == unit.y) occupied = true;
        if (!occupied && spend(unit.side, 1)) { mines.push_back({unit.x, unit.y, unit.side, 5}); unit.cooldown = 2; events.push_back(event(turn, "mine_planted", unit)); }
      } else if (action == 4 && unit.kind == 4 && unit.side == 0 && vault_distance(unit) <= 3 && unit.cooldown == 0 && spend(0, 2)) {
        charges.push_back({0, 2, 16}); unit.cooldown = 2;
        events.push_back(event(turn, "charge_placed", unit));
      }
    }

    std::vector<int> pending(units.size()), new_suppression(units.size());
    for (auto &unit : units) {
      if (!unit.alive()) continue;
      int action = action_of(unit);
      if (action == 4 || action == 6 || action == 7 || action == 8 || action == 10 ||
          action == 11 || action == 12 || action == 13) continue;
      int range = attack_range(unit.kind);
      if ((in_smoke(unit.x, unit.y, smokes) || rules.weather == 1) && unit.kind != 5) range = std::max(1, range - 2);
      int requested = orders.contains(unit.id) ? orders.at(unit.id).target : -1;
      Unit *target = nullptr;
      auto viable = [&](const Unit &other) {
        return other.alive() && other.side != unit.side && distance(unit, other) <= range &&
               line_clear(unit.x, unit.y, other.x, other.y, terrain) && visible(unit, other);
      };
      if (requested >= 0 && requested < int(units.size()) && viable(units[requested])) target = &units[requested];
      if (!target) for (auto &other : units) if (viable(other) && (!target || distance(unit, other) < distance(unit, *target))) target = &other;
      if (!target || unit.ammo == 0 || (unit.kind == 7 && unit.cooldown > 0)) continue;
      int hit = rules.damage[unit.kind] + counter(unit.kind, target->kind) + (unit.morale >= 8) - (unit.morale <= 3)
                - (unit.suppressed > 0) - (unit.stamina == 0);
      if (action == 9 && (unit.kind == 2 || unit.kind == 7 || unit.kind == 10)) {
        hit = std::max(1, hit / 2); new_suppression[target->id] = 2;
      }
      char cover = terrain[index(target->x, target->y)];
      hit -= (target->kind == 1 ? 2 : 0) + (target->entrenched ? 2 : 0) + (target->shield > 0 ? 1 : 0)
             + (cover == '%' ? 1 : cover == 'B' ? 2 : 0) + (target->side == 1 && vault_distance(*target) <= 3 ? 1 : 0);
      hit = std::max(1, hit);
      pending[target->id] += hit;
      if (unit.ammo > 0) --unit.ammo;
      if (unit.kind == 7) unit.cooldown = 2;
      events.push_back(event(turn, action == 9 ? "suppress" : "strike", unit, {{"target", target->id}, {"damage", hit}}));
    }
    for (auto &unit : units) if (unit.alive()) {
      if (pending[unit.id] > 0) {
        unit.hp -= pending[unit.id]; unit.shield = std::max(0, unit.shield - 1);
        unit.morale = std::max(0, unit.morale - (pending[unit.id] >= 7 ? 2 : 1));
      }
      unit.suppressed = std::max(unit.suppressed, new_suppression[unit.id]);
      if (!unit.alive()) events.push_back(event(turn, "fallen", unit));
    }

    int pressure = 0, protectors = 0;
    for (const auto &unit : units) if (unit.alive() && vault_distance(unit) <= (unit.kind == 4 && unit.side == 0 ? 3 : 2)) {
      if (unit.side == 1) ++protectors;
      else if (action_of(unit) == 0 || action_of(unit) == 2) pressure += unit.kind == 4 ? 3 : 2;
    }
    int breach = std::max(0, pressure - std::min(8, protectors * 2) - rules.vault_armor);
    for (auto it = charges.begin(); it != charges.end();) {
      --it->ttl;
      if (it->ttl > 0) { ++it; continue; }
      breach += std::max(4, it->damage - rules.vault_armor * 2);
      events.push_back({{"turn", turn}, {"type", "charge_detonated"}, {"x", vault_x}, {"y", vault_y}, {"damage", it->damage}});
      it = charges.erase(it);
    }
    integrity = std::max(0, integrity - breach);
    if (breach > 0) events.push_back({{"turn", turn}, {"type", "breach"}, {"amount", breach}, {"integrity", integrity}, {"x", vault_x}, {"y", vault_y}});
    if (integrity <= 25 && loot > 0) for (auto &unit : units) {
      if (loot == 0) break;
      if (unit.alive() && unit.side == 0 && !unit.carrying && vault_distance(unit) <= 1) {
        unit.carrying = true; --loot; events.push_back(event(turn, "treasure_taken", unit));
      }
    }
    for (auto &unit : units) if (unit.alive() && unit.side == 0 && unit.carrying) {
      const auto &post = raid_posts[unit.post];
      if (distance(unit.x, unit.y, post[0], post[1]) <= 1) {
        unit.carrying = false; ++extractions; events.push_back(event(turn, "extracted", unit));
      }
    }
    for (auto &mine : mines) --mine.ttl;
    mines.erase(std::remove_if(mines.begin(), mines.end(), [](const Mine &mine) { return mine.ttl <= 0; }), mines.end());
    for (auto &zone : smokes) --zone.ttl;
    smokes.erase(std::remove_if(smokes.begin(), smokes.end(), [](const Smoke &zone) { return zone.ttl <= 0; }), smokes.end());
  }

  int guard_total = 0, guard_dead = 0, raider_cost = 0, raider_alive_cost = 0, near[2] = {0, 0};
  for (const auto &unit : units) {
    if (unit.side == 1) { ++guard_total; if (!unit.alive()) ++guard_dead; }
    else { raider_cost += rules.cost[unit.kind]; if (unit.alive()) raider_alive_cost += rules.cost[unit.kind]; }
    if (unit.alive() && vault_distance(unit) <= 3) ++near[unit.side];
  }
  int breach_score = (100 - integrity) * 55 / 100;
  int casualty_score = guard_total ? guard_dead * 20 / guard_total : 0;
  int control_score = near[0] > near[1] ? 15 : near[0] && near[0] == near[1] ? 7 : 0;
  int survival_score = raider_cost ? raider_alive_cost * 10 / raider_cost : 0;
  int score = std::min(100, breach_score + casualty_score + control_score + survival_score + std::min(20, extractions * 10));
  int grade = 100 - integrity < 15 ? 0 : score >= rules.thresholds[2] ? 3 : score >= rules.thresholds[1] ? 2 : score >= rules.thresholds[0] ? 1 : 0;
  json trace = {{"version", 3}, {"round", round}, {"seed", seed}, {"weather", rules.weather}, {"turns", rules.turns},
                {"terrain", initial_terrain}, {"vault_integrity", integrity}, {"extractions", extractions},
                {"score", score}, {"grade", grade}, {"won", json::array({grade >= 1, grade >= 2, grade >= 3})}, {"events", events}};
  return {grade, score, trace};
}
} // namespace kazna
