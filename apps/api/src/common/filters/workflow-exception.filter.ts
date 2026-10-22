import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';

interface HttpResponse {
  status(code: number): {
    json(body: any): void;
  };
}

@Catch()
export class WorkflowExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<HttpResponse>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_SERVER_ERROR';
    let message = 'Đã xảy ra lỗi trong quá trình xử lý.';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'object' && res !== null) {
        const resObj = res as Record<string, any>;
        code = resObj.code || this.mapStatusToCode(status);
        message = Array.isArray(resObj.message)
          ? resObj.message.join('; ')
          : resObj.message || exception.message;
      } else {
        message = exception.message;
        code = this.mapStatusToCode(status);
      }
    } else if (exception instanceof Error) {
      const msg = exception.message;

      if (msg.includes('Xung đột tương tranh')) {
        status = HttpStatus.CONFLICT;
        code = 'CONCURRENCY_CONFLICT';
        message = msg;
      } else if (msg.includes('Không tìm thấy')) {
        status = HttpStatus.NOT_FOUND;
        code = 'DOCUMENT_NOT_FOUND';
        message = msg;
      } else if (
        msg.includes('không được phân công') ||
        msg.includes('REVIEWER') ||
        msg.includes('Không có quyền')
      ) {
        status = HttpStatus.FORBIDDEN;
        code = 'FORBIDDEN';
        message = msg;
      } else if (
        msg.includes('Chỉ có thể') ||
        msg.includes('Không thể') ||
        msg.includes('đang trong trạng thái') ||
        msg.includes('chưa được')
      ) {
        status = HttpStatus.UNPROCESSABLE_ENTITY;
        code = 'INVALID_STATE_TRANSITION';
        message = msg;
      } else {
        status = HttpStatus.INTERNAL_SERVER_ERROR;
        code = 'INTERNAL_ERROR';
        message = 'Lỗi hệ thống khi xử lý quy trình duyệt.';
      }
    }

    response.status(status).json({
      success: false,
      error: {
        code,
        message,
        timestamp: new Date().toISOString(),
      },
    });
  }

  private mapStatusToCode(status: number): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return 'VALIDATION_ERROR';
      case HttpStatus.UNAUTHORIZED:
        return 'UNAUTHORIZED';
      case HttpStatus.FORBIDDEN:
        return 'FORBIDDEN';
      case HttpStatus.NOT_FOUND:
        return 'DOCUMENT_NOT_FOUND';
      case HttpStatus.CONFLICT:
        return 'CONCURRENCY_CONFLICT';
      case HttpStatus.UNPROCESSABLE_ENTITY:
        return 'INVALID_STATE_TRANSITION';
      default:
        return 'INTERNAL_ERROR';
    }
  }
}
