#include "kazna.hpp"

namespace kazna::sdk {
std::vector<Recruit> deploy(const DeploymentContext &ctx) {
  Army army(ctx);
  for (int post = 0; post < 3; ++post) army.add(Kind::Shield, post);
  army.add(Kind::Pike, 0); army.add(Kind::Pike, 2);
  army.add(Kind::Archer, 0); army.add(Kind::Archer, 1);
  army.add(Kind::Crossbow, 1); army.add(Kind::Medic, 2);
  army.add(Kind::Engineer, 2); army.add(Kind::Herald, 2);
  return std::move(army).finish();
}

std::vector<Command> decide(const Observation &obs) {
  std::vector<Command> orders;
  for (const Unit &unit : obs.units) {
    if (!unit.friendly || unit.hp <= 0) continue;
    const Unit *enemy = nearest_enemy(unit, obs);
    int vault_distance = std::abs(unit.x - 12) + std::abs(unit.y - 7);
    if (unit.kind == Kind::Engineer && vault_distance <= 3 && obs.vault_integrity < 100 && unit.cooldown == 0 && obs.own_supply >= 2)
      orders.push_back({unit.id, Action::Repair});
    else if (unit.kind == Kind::Engineer && !unit.entrenched && obs.own_supply > 0)
      orders.push_back({unit.id, Action::Fortify});
    else if (unit.kind == Kind::Medic && unit.cooldown == 0 && obs.own_supply > 0) {
      const Unit *patient = nullptr;
      for (const Unit &friend_unit : obs.units)
        if (friend_unit.friendly && friend_unit.hp < obs.rules.health[static_cast<int>(friend_unit.kind)] &&
            std::abs(friend_unit.x - unit.x) + std::abs(friend_unit.y - unit.y) <= 3 &&
            (!patient || friend_unit.hp < patient->hp)) patient = &friend_unit;
      if (patient) orders.push_back({unit.id, Action::Heal, patient->id});
      else orders.push_back({unit.id, Action::Hold});
    } else if (unit.kind == Kind::Herald && vault_distance <= 4 && unit.cooldown == 0 && obs.own_supply > 0)
      orders.push_back({unit.id, Action::Rally});
    else if ((unit.kind == Kind::Shield || unit.kind == Kind::Pike) && !unit.entrenched && vault_distance <= 4 && obs.own_supply > 0)
      orders.push_back({unit.id, Action::Fortify});
    else if (enemy && (unit.kind == Kind::Archer || unit.kind == Kind::Crossbow))
      orders.push_back({unit.id, Action::Suppress, enemy->id});
    else if (enemy) orders.push_back({unit.id, Action::Focus, enemy->id});
    else orders.push_back({unit.id, Action::Hold});
  }
  return orders;
}
} // namespace kazna::sdk
