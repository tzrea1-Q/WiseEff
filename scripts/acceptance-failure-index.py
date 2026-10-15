"""Accepted-base, stdlib-only projection of the immutable Gate0 ZIP.

The workflow binds this code and its source inventory before candidate execution.
No title, exception, log, arbitrary path or candidate code is published or run.
"""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import signal
import stat
import sys
import zipfile

LIMIT = 256 * 1024
PROJECTS = {"browser": {"Desktop Chrome", "runtime-warmup"},
            "visual": {"visual", "compact", "runtime-warmup"}}
CATEGORIES = {"failed": "TEST_FAILED", "timedOut": "TEST_TIMEOUT", "interrupted": "TEST_INTERRUPTED"}


def require(condition):
    if not condition:
        raise ValueError()


def read_json(archive, entry, limit):
    require(entry.file_size <= limit)
    return json.loads(archive.read(entry))


def source_location(spec, phase, policy):
    name = spec.get("file", "")
    require(isinstance(name, str) and len(name) <= 1024 and not PurePosixPath(name).is_absolute() and "\\" not in name
            and not any(ord(c) < 32 for c in name) and ".." not in name.split("/"))
    prefix = "e2e/acceptance/" if phase == "browser" else "e2e/quality/"
    if not name.startswith("e2e/"):
        name = prefix + name
    line, column = spec.get("line"), spec.get("column")
    if type(line) is not int or type(column) is not int:
        return None
    if name.startswith(prefix) and [line, column] in policy["sources"].get(name, []):
        return {"file": name, "line": line, "column": column}
    return None


def project(archive_path, policy_path):
    require(policy_path.stat().st_size <= 1048576)
    policy = json.loads(policy_path.read_bytes())
    require(re.fullmatch(r"[0-9a-f]{40}", policy["acceptedBase"]) is not None)
    identity = policy["identity"]
    require(set(identity) == {"runId", "attempt", "shard", "executedSha", "tree"})
    for key in ("runId", "attempt"):
        require(re.fullmatch(r"[1-9][0-9]{0,19}", identity[key]) is not None)
    require(identity["shard"] in ("1", "2", "3", "4"))
    for key in ("executedSha", "tree"):
        require(re.fullmatch(r"[0-9a-f]{40}", identity[key]) is not None)
    require(isinstance(policy["sources"], dict) and len(policy["sources"]) <= 1000)
    for name, locations in policy["sources"].items():
        require(re.fullmatch(r"e2e/(?:acceptance|quality)/[A-Za-z0-9_./-]+\.spec\.ts", name) is not None
                and ".." not in name.split("/"))
        require(isinstance(locations, list) and len(locations) <= 10000)
        require(all(isinstance(item, list) and len(item) == 2
                    and all(type(n) is int and 0 < n <= 1000000 for n in item) for item in locations))
    info = archive_path.lstat()
    require(stat.S_ISREG(info.st_mode) and not info.st_mode & 0o222 and info.st_size <= 256 * 1024 * 1024)
    failures, unmapped, reports = {}, 0, 0
    with os.fdopen(os.open(archive_path, os.O_RDONLY | os.O_NOFOLLOW), "rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest() if hasattr(hashlib, "file_digest") else None
        if digest is None:
            stream.seek(0)
            hasher = hashlib.sha256()
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                hasher.update(chunk)
            digest = hasher.hexdigest()
        stream.seek(0)
        with zipfile.ZipFile(stream) as archive:
            entries = archive.infolist()
            require(len(entries) <= 10000 and len({entry.filename for entry in entries}) == len(entries))
            require(sum(entry.file_size for entry in entries) <= 512 * 1024 * 1024)
            for entry in entries:
                name = entry.filename
                require(not PurePosixPath(name).is_absolute() and ".." not in name.split("/")
                        and "\\" not in name and not any(ord(c) < 32 for c in name)
                        and not stat.S_ISLNK(entry.external_attr >> 16))
            names = {entry.filename: (index, entry) for index, entry in enumerate(entries)}
            snapshot = read_json(archive, names["gate0-upload-snapshot.json"][1], 65536)
            require(snapshot["version"] == 1 and snapshot["kind"] == "wiseeff-gate0-immutable-upload-snapshot"
                    and 0 < len(snapshot["runs"]) <= 20)
            for run in snapshot["runs"]:
                require(re.fullmatch(r"[A-Za-z0-9_-]{1,160}", run["runId"]) is not None
                        and run["sourceCommit"] == identity["executedSha"])
                for phase in ("visual", "browser"):
                    report_name = run["runId"] + "/artifacts/" + phase + "/test-results/results.json"
                    if report_name not in names:
                        continue
                    report_index, entry = names[report_name]
                    report = read_json(archive, entry, 8 * 1024 * 1024)
                    require(isinstance(report, dict) and isinstance(report.get("suites"), list))
                    reports += 1
                    visited = 0

                    def visit(suites, depth=0):
                        nonlocal visited, unmapped
                        require(depth <= 32 and isinstance(suites, list))
                        for suite in suites:
                            visited += 1
                            require(visited <= 10000 and isinstance(suite, dict))
                            for spec in suite.get("specs", []):
                                for test in spec.get("tests", []):
                                    results = test.get("results", [])
                                    require(isinstance(results, list) and len(results) <= 20)
                                    if not results or results[-1].get("status") not in CATEGORIES:
                                        continue
                                    location = source_location(spec, phase, policy)
                                    project_name = test.get("projectName")
                                    if location is None or project_name not in PROJECTS[phase]:
                                        unmapped += 1
                                        require(unmapped <= 10000)
                                        continue
                                    # Parameterized declarations share a trusted source ID; titles stay private.
                                    case_id = hashlib.sha256(json.dumps([phase, project_name, location], sort_keys=True).encode()).hexdigest()
                                    key = (case_id, results[-1]["status"], report_index)
                                    if key not in failures:
                                        failures[key] = {"caseId": case_id, "phase": phase,
                                                         "category": CATEGORIES[results[-1]["status"]],
                                                         "source": location, "count": 0,
                                                         "report": {"entry": report_index}}
                                    failures[key]["count"] += 1
                                    require(len(failures) <= 500)
                            visit(suite.get("suites", []), depth + 1)

                    visit(report["suites"])
    return {"schemaVersion": 1, "scope": "accepted-base-failure-index", "status": "generated" if reports else "unavailable",
            "code": "INDEX_GENERATED" if reports else "REPORT_UNAVAILABLE", "identity": identity,
            "acceptedBase": policy["acceptedBase"], "archiveSha256": digest, "reportsRead": reports,
            "unmappedFailures": unmapped, "failures": list(failures.values())}


def main():
    def timeout(_signal, _frame):
        raise TimeoutError()
    signal.signal(signal.SIGALRM, timeout)
    record = {"schemaVersion": 1, "scope": "accepted-base-failure-index", "status": "rejected",
              "code": "INDEX_REJECTED", "failures": []}
    code = 1
    try:
        budget_ms = int(os.environ.get("WISEEFF_FAILURE_INDEX_BUDGET_MS", "4500"))
        require(0 < budget_ms <= 4500)
        signal.setitimer(signal.ITIMER_REAL, budget_ms / 1000)
        require(len(sys.argv) == 4)
        record = project(Path(sys.argv[1]), Path(sys.argv[2]))
        require(len(json.dumps(record).encode()) + 1 <= LIMIT)
        code = 0
    except Exception:
        record = {"schemaVersion": 1, "scope": "accepted-base-failure-index", "status": "rejected",
                  "code": "INDEX_REJECTED", "failures": []}
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
    destination = Path(sys.argv[3])
    with os.fdopen(os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600), "w") as output:
        output.write(json.dumps(record) + "\n")
    return code


if __name__ == "__main__":
    sys.exit(main())
