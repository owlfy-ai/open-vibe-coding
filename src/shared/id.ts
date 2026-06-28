export type EntityId<T extends string> = string & { readonly __entity: T };

export interface IdGenerator {
  next<T extends string>(namespace: T): EntityId<T>;
}

export class CryptoIdGenerator implements IdGenerator {
  next<T extends string>(namespace: T): EntityId<T> {
    return `${namespace}_${crypto.randomUUID()}` as EntityId<T>;
  }
}

export class SequentialIdGenerator implements IdGenerator {
  private sequence = 0;

  next<T extends string>(namespace: T): EntityId<T> {
    this.sequence += 1;
    return `${namespace}_${this.sequence}` as EntityId<T>;
  }
}
