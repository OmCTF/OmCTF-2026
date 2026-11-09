#pragma once

#include "arena.hpp"

#include <string>
#include <sstream>
#include <memory>
#include <mutex>
#include <unordered_map>
#include <deque>
#include <vector>

namespace kazna {

class ExecutorUnavailable : public std::runtime_error {
 public:
  using std::runtime_error::runtime_error;
};

class CxxStrategy : public Commander {
 public:
  CxxStrategy(const std::string &source, const std::string &template_dir);
  CxxStrategy(const CxxStrategy &) = delete;
  CxxStrategy &operator=(const CxxStrategy &) = delete;
  ~CxxStrategy();
  void set_rules(const Rules &rules) override { rules_ = rules; }
  std::vector<Recruit> deploy(int side, int round, uint64_t seed, int budget) override;
  std::vector<UnitCommand> decide(const Observation &observation) override;

 private:
  struct Compiled;
  static std::mutex cache_mutex_;
  static std::unordered_map<std::string, std::shared_ptr<Compiled>> cache_;
  static std::deque<std::string> cache_order_;
  std::shared_ptr<Compiled> compiled_;
  std::string directory_;
  int input_ = -1;
  int output_ = -1;
  int child_ = -1;
  Rules rules_;
  void compile();
  void launch();
  std::string exchange(const std::string &input);
  void append_rules(std::ostringstream &out) const;
};

} // namespace kazna
