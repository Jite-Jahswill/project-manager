import {
  Body, Controller, Get, Headers, HttpCode, MessageEvent, Param, ParseUUIDPipe, Post, Query, Req, Res, Sse, StreamableFile,
} from '@nestjs/common';
import { ApiConsumes, ApiHeader, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { Observable } from 'rxjs';
import { RateLimit } from '../abuse/rate-limit.guard';
import { Auth, AuthIdentity, Meta, RequestMeta, VentidocRequest } from '../common/request-context';
import { contentDisposition } from './attachments';
import { CreateConversationDto, ListOwnQuery, MarkReadDto, MessagesQuery, SendMessageDto } from './dto/support.dto';
import { readUpload, SupportAttachmentsService } from './support-attachments.service';
import { SupportRealtimeService } from './support-realtime.service';
import { SupportService, Viewer } from './support.service';

const customer = (a: AuthIdentity): Viewer => ({ kind: 'customer', userId: a.userId });

/** Sets headers that keep a downloaded file inert in a browser. */
export function attachmentHeaders(res: Response, fileName: string, contentType: string, length: number): void {
  res.set({
    'Content-Type': contentType,
    'Content-Length': String(length),
    'Content-Disposition': contentDisposition(fileName),
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cache-Control': 'private, no-store',
  });
}

/**
 * Customer support API: any authenticated user, only their own conversations
 * (docs/architecture/09-support.md §5).
 */
@ApiTags('support')
@Controller('v1/support')
export class SupportController {
  constructor(
    private readonly support: SupportService,
    private readonly attachments: SupportAttachmentsService,
    private readonly realtime: SupportRealtimeService,
  ) {}

  @Post('conversations') @RateLimit('support.conversation.user', 'user')
  create(@Auth() a: AuthIdentity, @Body() dto: CreateConversationDto, @Meta() meta: RequestMeta) {
    return this.support.create(a.userId, dto, meta);
  }

  @Get('conversations')
  list(@Auth() a: AuthIdentity, @Query() q: ListOwnQuery) {
    return this.support.listOwn(a.userId, q);
  }

  @Get('conversations/:conversationId')
  get(@Auth() a: AuthIdentity, @Param('conversationId', ParseUUIDPipe) id: string) {
    return this.support.getOwn(a.userId, id);
  }

  @Get('conversations/:conversationId/messages')
  messages(@Auth() a: AuthIdentity, @Param('conversationId', ParseUUIDPipe) id: string, @Query() q: MessagesQuery) {
    return this.support.listMessages(customer(a), id, q);
  }

  @Post('conversations/:conversationId/messages') @RateLimit('support.message.user', 'user')
  send(@Auth() a: AuthIdentity, @Param('conversationId', ParseUUIDPipe) id: string, @Body() dto: SendMessageDto, @Meta() meta: RequestMeta) {
    return this.support.sendMessage(customer(a), id, dto, meta);
  }

  @Post('conversations/:conversationId/read') @HttpCode(200)
  read(@Auth() a: AuthIdentity, @Param('conversationId', ParseUUIDPipe) id: string, @Body() dto: MarkReadDto) {
    return this.support.markRead(customer(a), id, dto.upToSeq);
  }

  @Post('conversations/:conversationId/reopen') @HttpCode(200)
  reopen(@Auth() a: AuthIdentity, @Param('conversationId', ParseUUIDPipe) id: string, @Meta() meta: RequestMeta) {
    return this.support.reopen(a.userId, id, meta);
  }

  @Post('conversations/:conversationId/attachments') @RateLimit('support.upload.user', 'user')
  @ApiConsumes('image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf', 'text/plain')
  @ApiHeader({ name: 'X-File-Name', required: false, description: 'URL-encoded original file name' })
  async upload(
    @Auth() a: AuthIdentity, @Param('conversationId', ParseUUIDPipe) id: string, @Req() req: VentidocRequest,
    @Headers('content-type') type: string | undefined, @Headers('x-file-name') name: string | undefined, @Meta() meta: RequestMeta,
  ) {
    return this.attachments.upload(customer(a), id, await readUpload(req), type, name, meta);
  }

  @Get('attachments/:attachmentId/content')
  async download(@Auth() a: AuthIdentity, @Param('attachmentId', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response, @Meta() meta: RequestMeta) {
    const file = await this.attachments.download(customer(a), id, meta);
    attachmentHeaders(res, file.fileName, file.contentType, file.data.length);
    return new StreamableFile(file.data);
  }

  @Get('unread')
  unread(@Auth() a: AuthIdentity) {
    return this.support.customerUnreadSummary(a.userId);
  }

  /** Server-sent events for the caller's own conversations. Missed events: GET messages?afterSeq=N. */
  @Sse('stream')
  stream(@Auth() a: AuthIdentity): Observable<MessageEvent> {
    return this.realtime.stream({ kind: 'customer', userId: a.userId, sessionId: a.sessionId });
  }
}
