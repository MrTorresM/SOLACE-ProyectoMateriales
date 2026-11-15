CXX ?= c++
CXXFLAGS = -std=c++17 -Wall -Wextra -O1

all: build/test_logic build/logic_cli
	./build/test_logic

build/test_logic: test_logic.cpp ../solace_esp32/logic.h
	@mkdir -p build
	$(CXX) $(CXXFLAGS) -o $@ test_logic.cpp

build/logic_cli: logic_cli.cpp ../solace_esp32/logic.h
	@mkdir -p build
	$(CXX) $(CXXFLAGS) -o $@ logic_cli.cpp

clean:
	rm -rf build

.PHONY: all clean
