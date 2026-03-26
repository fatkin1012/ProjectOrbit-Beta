export function getHostGlobal() {
  return globalThis.__TOOLBOX_HOST__ ?? null;
}

export function getHostVersion() {
  return '0.1.0';
}
