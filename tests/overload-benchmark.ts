import { executeOverloadBenchmark } from '../src/memory/causal-benchmark';

export * from '../src/memory/causal-benchmark';

if (import.meta.main) {
  executeOverloadBenchmark().then((report) => {
    process.exit(report.allPassed ? 0 : 1);
  });
}
