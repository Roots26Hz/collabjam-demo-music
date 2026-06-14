import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export const notFound: RequestHandler = (_request, _response, next) => {
  next(
    new HttpError(404, "NOT_FOUND", "The requested resource was not found.")
  );
};

export const errorHandler: ErrorRequestHandler = (
  error,
  request,
  response,
  _next
) => {
  void _next;
  if (error instanceof ZodError) {
    response.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed.",
        issues: error.issues
      }
    });
    return;
  }

  if (error instanceof HttpError) {
    response
      .status(error.status)
      .json({ error: { code: error.code, message: error.message } });
    return;
  }

  request.log?.error({ error }, "Unhandled request error");
  response.status(500).json({
    error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." }
  });
};
