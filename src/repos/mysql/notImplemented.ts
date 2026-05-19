export function mysqlNotImplemented(method: string): never {
  throw new Error(
    `MySQL repo scaffold is not implemented yet. Tried to call ${method}.`,
  );
}
