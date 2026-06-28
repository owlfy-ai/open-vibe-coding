export interface Clock {
  now(): number;
}

export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
}

export class FixedClock implements Clock {
  constructor(private timestamp: number) {}

  now(): number {
    return this.timestamp;
  }

  set(timestamp: number): void {
    this.timestamp = timestamp;
  }
}
