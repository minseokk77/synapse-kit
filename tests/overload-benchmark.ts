import { executeOverloadBenchmark } from '../memory/causal-benchmark';

export * from '../memory/causal-benchmark';

if (import.meta.main) {
  executeOverloadBenchmark().then((report) => {
    process.exit(report.allPassed ? 0 : 1);
  });
}
