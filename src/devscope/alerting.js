export function createAlertDispatcher(options = {}) {
  const enabled = options.enabled ?? false;
  const webhookUrls = {
    slack: options.slackWebhookUrl,
    pagerduty: options.pagerDutyWebhookUrl,
    webhook: options.webhookUrl,
  };
  const send =
    typeof options.send === "function" ? options.send : defaultSendWebhook;

  async function sendAlert(payload = {}) {
    const channels = resolveChannels(payload.channel);
    const context = payload.context ?? {};

    const notifications = [];
    for (const channel of channels) {
      const url = webhookUrls[channel];
      if (!enabled || !url) {
        notifications.push({
          channel,
          ok: false,
          error: "channel_not_configured",
        });
        continue;
      }

      try {
        const response = await send(url, {
          channel,
          severity: payload.severity ?? "warning",
          title: payload.title ?? "DevScope Alert",
          message: payload.message ?? "No message",
          context,
          timestampMs: Date.now(),
        });
        notifications.push({
          channel,
          ok: response.ok,
          status: response.status,
        });
      } catch (error) {
        notifications.push({
          channel,
          ok: false,
          error: error instanceof Error ? error.message : "send_failed",
        });
      }
    }

    return {
      ok: notifications.some((item) => item.ok),
      notifications,
    };
  }

  async function notifyIncident(report, options = {}) {
    const incident = report?.incident ?? "incident";
    const topServices = Array.isArray(report?.impactedServices)
      ? report.impactedServices.slice(0, 3).map((item) => item.service)
      : [];

    return sendAlert({
      channel: options.channel ?? "all",
      severity: options.severity ?? "critical",
      title: `Incident correlated: ${incident}`,
      message: `${report?.candidateTraceCount ?? 0} candidate traces, impacted services: ${topServices.join(", ") || "none"}`,
      context: {
        report,
      },
    });
  }

  return {
    enabled,
    sendAlert,
    notifyIncident,
  };
}

async function defaultSendWebhook(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  return {
    ok: response.ok,
    status: response.status,
  };
}

function resolveChannels(channel) {
  if (channel === "all" || !channel) {
    return ["slack", "pagerduty", "webhook"];
  }

  return [String(channel).trim().toLowerCase()];
}
