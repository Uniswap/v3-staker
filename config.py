import os
import json

ROOT_DIR = os.path.dirname(__file__)


def load_abi(name):
    path = os.path.join(ROOT_DIR, "artifacts", "abis", f"{name}.json")
    return json.load(open(path))
