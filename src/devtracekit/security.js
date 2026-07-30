function normalizePermissionSet(permissions = []) {
  return new Set(
    permissions.map((value) => String(value).trim()).filter(Boolean),
  );
}

export function createSecurityManager(options = {}) {
  const enabled = options.enabled ?? false;
  const auditMaxEntries = Math.max(
    100,
    Number(options.auditMaxEntries ?? 5000),
  );
  const keyEntries = Array.isArray(options.apiKeys) ? options.apiKeys : [];

  const apiKeyMap = new Map();
  for (const entry of keyEntries) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const key = String(entry.key ?? "").trim();
    if (!key) {
      continue;
    }

    apiKeyMap.set(key, {
      keyId: String(entry.keyId ?? `${entry.role ?? "viewer"}-key`),
      role: String(entry.role ?? "viewer"),
      permissions: normalizePermissionSet(resolveRolePermissions(entry.role)),
      label: entry.label ? String(entry.label) : undefined,
    });
  }

  const auditLog = [];

  function addAudit(entry) {
    auditLog.push({
      id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      timestampMs: Date.now(),
      ...entry,
    });

    while (auditLog.length > auditMaxEntries) {
      auditLog.shift();
    }
  }

  function listAudit(options = {}) {
    const limit = Math.max(
      1,
      Math.min(Number(options.limit ?? 200), auditMaxEntries),
    );
    return auditLog.slice(-limit).reverse();
  }

  function resolveApiKey(req) {
    const explicit = req.header("x-devtracekit-api-key");
    if (explicit && explicit.trim().length > 0) {
      return explicit.trim();
    }

    const authHeader = req.header("authorization");
    if (!authHeader) {
      return "";
    }

    const [scheme, value] = authHeader.split(" ");
    if (scheme?.toLowerCase() !== "bearer") {
      return "";
    }

    return value?.trim() ?? "";
  }

  function authenticate(req) {
    if (!enabled) {
      return {
        ok: true,
        actor: {
          keyId: "local-dev",
          role: "admin",
          permissions: normalizePermissionSet(resolveRolePermissions("admin")),
        },
      };
    }

    const apiKey = resolveApiKey(req);
    const actor = apiKeyMap.get(apiKey);
    if (!actor) {
      return { ok: false, error: "invalid_api_key" };
    }

    return { ok: true, actor };
  }

  function hasPermission(actor, permission) {
    if (!permission || permission === "none") {
      return true;
    }

    if (actor.permissions.has("admin")) {
      return true;
    }

    return actor.permissions.has(permission);
  }

  function requirePermission(permission) {
    return (req, res, next) => {
      const authResult = authenticate(req);
      if (!authResult.ok) {
        addAudit({
          action: req.method,
          resource: req.path,
          status: "denied",
          reason: authResult.error,
          ip: req.ip,
        });
        res.status(401).json({ error: authResult.error });
        return;
      }

      if (!hasPermission(authResult.actor, permission)) {
        addAudit({
          action: req.method,
          resource: req.path,
          status: "denied",
          reason: "insufficient_permission",
          actorKeyId: authResult.actor.keyId,
          actorRole: authResult.actor.role,
          permission,
          ip: req.ip,
        });
        res.status(403).json({ error: "forbidden" });
        return;
      }

      req.devtracekitActor = authResult.actor;
      addAudit({
        action: req.method,
        resource: req.path,
        status: "allowed",
        actorKeyId: authResult.actor.keyId,
        actorRole: authResult.actor.role,
        permission,
        ip: req.ip,
      });
      next();
    };
  }

  return {
    enabled,
    requirePermission,
    listAudit,
    addAudit,
    roles: {
      viewer: resolveRolePermissions("viewer"),
      editor: resolveRolePermissions("editor"),
      admin: resolveRolePermissions("admin"),
    },
  };
}

function resolveRolePermissions(role) {
  const normalized = String(role ?? "viewer").toLowerCase();
  if (normalized === "admin") {
    return ["read", "write", "admin"];
  }
  if (normalized === "editor") {
    return ["read", "write"];
  }
  return ["read"];
}
