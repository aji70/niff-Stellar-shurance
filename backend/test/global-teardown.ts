export default async function globalTeardown() {
  await Promise.all([
    global.__PG_CONTAINER__?.stop(),
    global.__REDIS_CONTAINER__?.stop(),
  ]);
}
