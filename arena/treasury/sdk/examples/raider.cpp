#include "kazna.hpp"

namespace kazna::sdk {
std::vector<Recruit> deploy(const DeploymentContext &ctx) {
  Army army(ctx);
  for (int post = 0; post < 3; ++post) army.add(Kind::Sapper, post);
  army.add(Kind::Shield, 0); army.add(Kind::Shield, 1);
  army.add(Kind::Medic, 1); army.add(Kind::Alchemist, 2);
  army.add(Kind::Scout, 2); army.add(Kind::Rider, 2);
  army.add(Kind::Crossbow, 0); army.add(Kind::Herald, 1);
  return std::move(army).finish();
}

std::vector<Command> decide(const Observation &obs) {
  std::vector<Command> orders;
  for (const Unit &unit : obs.units) {
    if (!unit.friendly || unit.hp <= 0) continue;
    const Unit *enemy = nearest_enemy(unit, obs);
    int vault_distance = std::abs(unit.x - 12) + std::abs(unit.y - 7);
    if (unit.carrying) orders.push_back({unit.id, Action::Retreat});
    else if (unit.kind == Kind::Sapper && vault_distance <= 3 && unit.cooldown == 0 && obs.own_supply >= 2)
      orders.push_back({unit.id, Action::Breach});
    else if (unit.kind == Kind::Medic && unit.cooldown == 0 && obs.own_supply > 0) {
      const Unit *patient = nullptr;
      for (const Unit &friend_unit : obs.units)
        if (friend_unit.friendly && friend_unit.hp < obs.rules.health[static_cast<int>(friend_unit.kind)] &&
            std::abs(friend_unit.x - unit.x) + std::abs(friend_unit.y - unit.y) <= 3 &&
            (!patient || friend_unit.hp < patient->hp)) patient = &friend_unit;
      if (patient) orders.push_back({unit.id, Action::Heal, patient->id});
      else orders.push_back({unit.id, Action::Advance});
    } else if (unit.kind == Kind::Alchemist && enemy && vault_distance <= 6 && unit.cooldown == 0 && obs.own_supply > 0)
      orders.push_back({unit.id, Action::Smoke});
    else if (unit.kind == Kind::Herald && vault_distance <= 5 && unit.cooldown == 0 && obs.own_supply > 0)
      orders.push_back({unit.id, Action::Rally});
    else if (unit.kind == Kind::Crossbow && enemy) orders.push_back({unit.id, Action::Suppress, enemy->id});
    else if (unit.kind == Kind::Rider && unit.stamina >= 3 && vault_distance > 5)
      orders.push_back({unit.id, Action::Dash, -1, 16, 7});
    else if (enemy) orders.push_back({unit.id, Action::Focus, enemy->id});
    else orders.push_back({unit.id, Action::Advance});
  }
  return orders;
}
} // namespace kazna::sdk
