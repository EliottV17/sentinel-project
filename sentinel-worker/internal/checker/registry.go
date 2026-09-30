package checker

import "fmt"

var registry = map[string]Checker{}

func Register(checkType string, c Checker) {
	registry[checkType] = c
}

func Get(checkType string) (Checker, error) {
	c, ok := registry[checkType]
	if !ok {
		return nil, fmt.Errorf("unknown checker type: %s", checkType)
	}
	return c, nil
}