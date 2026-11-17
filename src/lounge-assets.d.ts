declare module 'virtual:lounge-catalog' {
  const catalog: import('./lib/lounge-catalog').LoungeCatalog;
  export default catalog;
}
declare module 'virtual:lounge-validator' {
  const validate: (value: unknown) => boolean;
  export default validate;
}
