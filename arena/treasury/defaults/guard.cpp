#include "kazna.hpp"
namespace kazna::sdk {
std::vector<Recruit> deploy(const DeploymentContext &ctx) {
    Army army(ctx);
    for (int post = 0; post < 3; ++post) { army.add(Kind::Shield, post); army.add(Kind::Archer, post); }
    army.add(Kind::Blade, 1);
    return std::move(army).finish();
}
std::vector<Command> decide(const Observation &obs) {
    std::vector<Command> orders;
    for (const auto &unit : obs.units) if (unit.friendly && unit.hp > 0) {
        if (const auto *enemy = nearest_enemy(unit, obs)) orders.push_back({unit.id, Action::Focus, enemy->id});
        else orders.push_back({unit.id, Action::Hold});
    }
    return orders;
}}
