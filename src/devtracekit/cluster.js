export function createClusterManager(options = {}) {
  const enabled = options.enabled ?? false;
  const ttlMs = Math.max(5_000, Number(options.ttlMs ?? 30_000));
  const deploymentMode = options.deploymentMode ?? "single-node";
  const instances = new Map();

  function heartbeat(payload = {}) {
    const instanceId = String(payload.instanceId ?? "").trim();
    if (!instanceId) {
      return { ok: false, error: "instance_id_required" };
    }

    const now = Date.now();
    const current = instances.get(instanceId) ?? {
      instanceId,
      firstSeenMs: now,
    };

    current.role = String(payload.role ?? "api");
    current.version = String(payload.version ?? "dev");
    current.capacity = Number(payload.capacity ?? 1);
    current.environment = payload.environment
      ? String(payload.environment)
      : undefined;
    current.lastSeenMs = now;

    instances.set(instanceId, current);
    evictExpired(now);

    return { ok: true, instance: current };
  }

  function evictExpired(now = Date.now()) {
    for (const [key, instance] of instances.entries()) {
      if (now - instance.lastSeenMs > ttlMs) {
        instances.delete(key);
      }
    }
  }

  function status() {
    const now = Date.now();
    evictExpired(now);

    const activeInstances = Array.from(instances.values()).sort((a, b) =>
      a.instanceId.localeCompare(b.instanceId),
    );

    const roles = {};
    for (const item of activeInstances) {
      roles[item.role] = (roles[item.role] ?? 0) + 1;
    }

    return {
      ok: true,
      enabled,
      deploymentMode,
      ttlMs,
      activeInstanceCount: activeInstances.length,
      roles,
      instances: activeInstances,
      generatedAtMs: now,
    };
  }

  return {
    enabled,
    heartbeat,
    status,
  };
}
