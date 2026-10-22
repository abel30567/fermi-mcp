# detach.py LOG OUT CMD [ARGS...] — run CMD in a NEW session (survives the caller's process group,
# unlike `nohup … &` inside a tool call). stdout -> OUT (the worker's JSON), stderr -> LOG. Prints the PID.
import subprocess, sys

log, out = open(sys.argv[1], "w"), open(sys.argv[2], "w")
p = subprocess.Popen(sys.argv[3:], stdout=out, stderr=log, stdin=subprocess.DEVNULL, start_new_session=True)
print(p.pid)
