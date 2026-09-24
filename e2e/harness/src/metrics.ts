const SAMPLE_LIMIT = 512;

export class Samples {
  private values: number[] = [];
  private count = 0;
  private total = 0;
  private max = 0;

  add(value: number): void {
    this.values[this.count % SAMPLE_LIMIT] = value;
    this.count++;
    this.total += value;
    this.max = Math.max(this.max, value);
  }

  report() {
    const sorted = [...this.values].sort((a, b) => a - b);
    const percentile = (p: number) =>
      sorted.length ? sorted[Math.ceil(sorted.length * p) - 1] : null;
    return {
      count: this.count,
      retained: sorted.length,
      mean: this.count ? this.total / this.count : null,
      max: this.count ? this.max : null,
      p50: percentile(0.5),
      p95: percentile(0.95),
      p99: percentile(0.99),
    };
  }
}
