import { context, SpanStatusCode, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { BasicTracerProvider } from "@opentelemetry/sdk-trace-base";

class DevTraceKitSpanProcessor {
  constructor(core, serviceName, scope = {}) {
    this.core = core;
    this.serviceName = serviceName;
    this.scope = scope;
  }

  onStart() {}

  onEnd(span) {
    const spanContext = span.spanContext();
    this.core.instrument.otelSpan(
      {
        traceId: spanContext.traceId,
        spanId: spanContext.spanId,
        parentSpanId: span.parentSpanId,
        name: span.name,
        kind: String(span.kind),
        statusCode: span.status?.code,
        status: span.status?.code === SpanStatusCode.ERROR ? "error" : "ok",
        attributes: span.attributes,
        startTime: span.startTime,
        endTime: span.endTime,
      },
      {
        serviceName: this.serviceName,
        tenantId: this.scope.tenantId,
        projectId: this.scope.projectId,
        environment: this.scope.environment,
      },
    );
  }

  forceFlush() {
    return Promise.resolve();
  }

  shutdown() {
    return Promise.resolve();
  }
}

export function createDevTraceKitSdk({
  core,
  serviceName = "node-service",
  tenantId,
  projectId,
  environment,
}) {
  if (!core?.instrument?.otelSpan) {
    throw new Error("DevTraceKit core with instrument.otelSpan is required");
  }

  const provider = new BasicTracerProvider({
    spanProcessors: [
      new DevTraceKitSpanProcessor(core, serviceName, {
        tenantId,
        projectId,
        environment,
      }),
    ],
  });

  // Enable async context propagation so child spans preserve parent trace IDs.
  try {
    const contextManager = new AsyncLocalStorageContextManager().enable();
    context.setGlobalContextManager(contextManager);
  } catch (error) {
    console.warn(
      `[devtracekit] context manager registration skipped: ${error.message}`,
    );
  }

  const tracer = provider.getTracer("@devtracekit/sdk", "0.1.0");

  async function runInSpan(name, options = {}, fn = async () => undefined) {
    const span = tracer.startSpan(name, {
      attributes: options.attributes ?? {},
    });

    const spanContext = trace.setSpan(context.active(), span);
    return context.with(spanContext, async () => {
      try {
        const result = await fn(span);
        if (options.statusCode) {
          span.setAttribute("http.status_code", options.statusCode);
        }
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (error) {
        span.recordException(error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error.message,
        });
        throw error;
      } finally {
        span.end();
      }
    });
  }

  function recordSpan(spanData) {
    return core.instrument.otelSpan(spanData, {
      serviceName,
      tenantId,
      projectId,
      environment,
    });
  }

  return {
    tracer,
    runInSpan,
    recordSpan,
    shutdown: () => provider.shutdown(),
    forceFlush: () => provider.forceFlush(),
  };
}
