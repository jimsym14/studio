export const buildFriendshipId = (uidA: string, uidB: string) => {
  return [uidA, uidB].sort().join('_');
};

export const buildRequestId = (from: string, to: string) => `${from}__${to}`;

export const uniqueIds = (values: string[]) =>
  Array.from(new Set(values.filter((value) => typeof value === 'string' && value.length > 0)));
