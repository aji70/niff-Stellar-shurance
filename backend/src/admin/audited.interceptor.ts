import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AdminAuditLog } from './entities/admin-audit-log.entity';

/**
 * Marks a controller route (or handler) as audited. The interceptor records
 * the actor, action, target, request id and outcome for every invocation.
 */
export const AUDITED_ACTION = 'admin:audited-action';

export function Audited(action: string): MethodDecorator & ClassDecorator {
  return (
    target: object,
    _key?: string | symbol,
    descriptor?: TypedPropertyDescriptor<unknown>,
  ) => {
    if (descriptor) {
      Reflect.defineMetadata(AUDITED_ACTION, action, descriptor.value as object);
    } else {
      Reflect.defineMetadata(AUDITED_ACTION, action, target);
    }
  };
}

interface AuditedRequest {
  user?: { id?: string; sub?: string; email?: string };
  params?: Record<string, string>;
  query?: Record<string, string>;
  body?: Record<string, unknown>;
  headers?: Record<string, string | string[] | undefined>;
  method?: string;
  originalUrl?: string;
  url?: string;
  requestId?: string;
}

@Injectable()
export class AuditedInterceptor implements NestInterceptor {
  constructor(
    @InjectRepository(AdminAuditLog)
    private readonly auditLog: Repository<AdminAuditLog>,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const handler = context.getHandler();
    const controller = context.getClass();
    const action =
      (Reflect.getMetadata(AUDITED_ACTION, handler) as string | undefined) ??
      (Reflect.getMetadata(AUDITED_ACTION, controller) as string | undefined);

    if (!action) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<AuditedRequest>();
    const actor = this.resolveActor(request);
    const target = this.resolveTarget(request);
    const requestId = this.resolveRequestId(request);

    return next.handle().pipe(
      tap({
        next: () => {
          void this.record(action, actor, target, requestId, 'success');
        },
        error: (error: unknown) => {
          const outcome =
            error instanceof Error ? `error:${error.name}` : 'error';
          void this.record(action, actor, target, requestId, outcome);
        },
      }),
    );
  }

  private resolveActor(request: AuditedRequest): string {
    const user = request.user;
    return user?.id ?? user?.sub ?? user?.email ?? 'anonymous';
  }

  private resolveTarget(request: AuditedRequest): string | null {
    const params = request.params ?? {};
    const id = params.id ?? params.claimId ?? params.policyId;
    if (id) {
      return id;
    }
    return request.originalUrl ?? request.url ?? null;
  }

  private resolveRequestId(request: AuditedRequest): string | null {
    if (request.requestId) {
      return request.requestId;
    }
    const header = request.headers?.['x-request-id'];
    if (Array.isArray(header)) {
      return header[0] ?? null;
    }
    return header ?? null;
  }

  private async record(
    action: string,
    actor: string,
    target: string | null,
    requestId: string | null,
    outcome: string,
  ): Promise<void> {
    try {
      await this.auditLog.insert({
        action,
        actor,
        target,
        requestId,
        outcome,
      });
    } catch {
      // Audit logging must never break the request pipeline.
    }
  }
}
