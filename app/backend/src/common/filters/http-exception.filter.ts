import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ValidationError } from 'class-validator';
import { LoggerService } from '../../logger/logger.service';

export interface ErrorResponse {
  code: number;
  message: string;
  details?: unknown;
  traceId?: string;
  timestamp: string;
  path: string;
}

/** Minimal shape for an arbitrary thrown value (Error-like or not). */
interface ExceptionLike {
  constructor?: { name?: string };
  status?: number;
  message?: string;
  stack?: string;
}

/** Shape of a Prisma client error, duck-typed since we don't depend on @prisma/client error classes here. */
interface PrismaErrorLike extends ExceptionLike {
  code?: string;
  clientVersion?: string;
  meta?: Record<string, unknown>;
}

@Injectable()
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: LoggerService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const traceId = request.headers['x-request-id'] as string | undefined;
    const err = exception as ExceptionLike;

    // Log the error
    this.logger.error(
      `Trace ID: ${traceId ?? 'N/A'} | ${err.constructor?.name ?? 'UnknownError'} | Status: ${
        err.status || HttpStatus.INTERNAL_SERVER_ERROR
      } | Message: ${err.message} | Path: ${request.url}`,
      err.stack,
      'AllExceptionsFilter',
    );

    let errorResponse: ErrorResponse;

    if (exception instanceof HttpException) {
      errorResponse = this.handleHttpException(exception, request, traceId);
    } else if (this.isPrismaError(exception)) {
      errorResponse = this.handlePrismaError(
        exception as PrismaErrorLike,
        request,
        traceId,
      );
    } else if (
      Array.isArray(exception) &&
      exception.some(e => e instanceof ValidationError)
    ) {
      errorResponse = this.handleValidationErrors(exception, request, traceId);
    } else {
      errorResponse = this.handleGenericError(exception, request, traceId);
    }

    response.status(errorResponse.code).json(errorResponse);
  }

  private handleHttpException(
    exception: HttpException,
    request: Request,
    traceId?: string,
  ): ErrorResponse {
    const status = exception.getStatus();
    const exceptionResponse = exception.getResponse();
    const message =
      typeof exceptionResponse === 'string'
        ? exceptionResponse
        : (exceptionResponse as { message?: unknown }).message ||
          exception.message;

    return {
      code: status,
      message: typeof message === 'string' ? message : JSON.stringify(message),
      details:
        typeof exceptionResponse === 'object' ? exceptionResponse : undefined,
      traceId,
      timestamp: new Date().toISOString(),
      path: request.url,
    };
  }

  private isPrismaError(exception: unknown): boolean {
    const err = exception as PrismaErrorLike;
    return Boolean(
      err?.constructor?.name?.includes('Prisma') ||
        err?.clientVersion ||
        err?.meta?.target,
    );
  }

  private handlePrismaError(
    exception: PrismaErrorLike,
    request: Request,
    traceId?: string,
  ): ErrorResponse {
    let code = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Database error occurred';
    let details: Record<string, unknown> | null = null;

    // Map common Prisma errors
    if (exception.code === 'P2002') {
      // Unique constraint failed
      code = HttpStatus.CONFLICT;
      message = 'Unique constraint violation';
      const target = exception.meta?.target;
      details = {
        target,
        field: Array.isArray(target) ? target.join(', ') : target,
      };
    } else if (exception.code === 'P2025') {
      // Record not found
      code = HttpStatus.NOT_FOUND;
      message = 'Record not found';
      details = {
        cause: exception.meta?.cause,
      };
    } else if (exception.code === 'P2003') {
      // Foreign key constraint failed
      code = HttpStatus.BAD_REQUEST;
      message = 'Foreign key constraint violation';
      details = {
        field_name: exception.meta?.field_name,
      };
    } else if (exception.code === 'P2000') {
      // Value too long for column
      code = HttpStatus.BAD_REQUEST;
      message = 'Value too long for column';
      details = {
        column_name: exception.meta?.column_name,
      };
    } else {
      details = {
        code: exception.code,
        meta: exception.meta,
      };
    }

    return {
      code,
      message,
      details,
      traceId,
      timestamp: new Date().toISOString(),
      path: request.url,
    };
  }

  private handleValidationErrors(
    exceptions: ValidationError[],
    request: Request,
    traceId?: string,
  ): ErrorResponse {
    const validationErrors = exceptions.map(error => ({
      property: error.property,
      value: error.value,
      constraints: error.constraints,
      children: error.children?.length
        ? this.formatChildren(error.children)
        : undefined,
    }));

    return {
      code: HttpStatus.UNPROCESSABLE_ENTITY,
      message: 'Validation failed',
      details: {
        errors: validationErrors,
      },
      traceId,
      timestamp: new Date().toISOString(),
      path: request.url,
    };
  }

  private formatChildren(children: ValidationError[]): Record<string, unknown>[] {
    return children.map(child => ({
      property: child.property,
      value: child.value,
      constraints: child.constraints,
      children: child.children?.length
        ? this.formatChildren(child.children)
        : undefined,
    }));
  }

  private handleGenericError(
    exception: unknown,
    request: Request,
    traceId?: string,
  ): ErrorResponse {
    const err = exception as ExceptionLike;
    return {
      code: HttpStatus.INTERNAL_SERVER_ERROR,
      message: err.message || 'Internal server error',
      details: {
        error_type: err.constructor?.name,
        ...(typeof process !== 'undefined' &&
          process.env.NODE_ENV === 'development' && {
            stack: err.stack,
          }),
      },
      traceId,
      timestamp: new Date().toISOString(),
      path: request.url,
    };
  }
}
