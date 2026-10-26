export class IdGenerator {
  private counter: number;

  constructor(start = 1) {
    this.counter = start;
  }

  next(): number {
    return this.counter++;
  }

  getState(): number {
    return this.counter;
  }

  setState(counter: number): void {
    this.counter = counter;
  }
}
