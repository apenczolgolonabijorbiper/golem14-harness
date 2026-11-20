// Implement storage-specific operations outside the installed engine.
// See docs/ADAPTERS.md. Every missing backend operation fails closed.
export function createAdapter(backend) {
  const call = (name, options) => {
    if (typeof backend?.[name] !== 'function') throw Error('Storage backend operation not implemented: '+name);
    return backend[name](options);
  };
  return {
    status: options => call('status',options),
    claim: options => call('claim',options),
    renew: options => call('renew',options),
    validate: options => call('validate',options),
    commit: options => call('commit',options),
    'release-error': options => call('release-error',options),
  };
}
// Backend implementers must provide consistent snapshot reads, observation readiness,
// atomic lease acquisition/renewal, isolated candidate capture, prior-graph validation,
// expected-version completion, persistence verification and owned-lease error release.
// Do not substitute independent file writes for a transaction or ignore an absent hook.
