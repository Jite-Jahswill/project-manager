import {
  Body, Controller, Get, Headers, HttpCode, MessageEvent, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res, Sse, StreamableFile,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { from, Observable, switchMap } from 'rxjs';
import { RateLimit } from '../abuse/rate-limit.guard';
import { RequireAnyPlatformPermission, RequirePlatformPermission } from '../authz/platform-access.guard';
import { PlatformAuthzService } from '../authz/platform-authz.service';
import { Errors } from '../common/errors';
import { Auth, AuthIdentity, Meta, RequestMeta, VentidocRequest } from '../common/request-context';
import { AssignDto, InboxQuery, MarkReadDto, MessagesQuery, NoteDto, SendMessageDto, UpdateConversationDto } from './dto/support.dto';
import { StaffAccess, staffAccessFrom } from './support-access';
import { readUpload, SupportAttachmentsService } from './support-attachments.service';
import { SupportRealtimeService } from './support-realtime.service';
import { SupportService } from './support.service';
import { attachmentHeaders } from './support.controller';

/**
 * Platform support console API (docs/security/support.md §2). The guard admits holders of
 * the listed permission(s); the service then applies row visibility on every request:
 * inbox staff see everything, agents only what is assigned to them.
 */
@ApiTags('platform-support')
@Controller('v1/platform/support')
export class SupportAdminController {
  constructor(
    private readonly support: SupportService,
    private readonly attachments: SupportAttachmentsService,
    private readonly realtime: SupportRealtimeService,
    private readonly platformAuthz: PlatformAuthzService,
  ) {}

  /** Loaded per request (no caching): role changes apply to the next request. */
  private async access(a: AuthIdentity): Promise<StaffAccess> {
    const loaded = await this.platformAuthz.load(a.userId);
    if (!loaded) throw Errors.forbidden();
    return staffAccessFrom(a.userId, loaded.permissions);
  }

  private async staff(a: AuthIdentity) {
    return { kind: 'staff' as const, userId: a.userId, access: await this.access(a) };
  }

  @Get('conversations') @RequireAnyPlatformPermission('platform.support.inbox.read', 'platform.support.assigned.access')
  async inbox(@Auth() a: AuthIdentity, @Query() q: InboxQuery) {
    return this.support.inbox(await this.access(a), q);
  }

  @Get('conversations/:conversationId') @RequireAnyPlatformPermission('platform.support.inbox.read', 'platform.support.assigned.access')
  async get(@Auth() a: AuthIdentity, @Param('conversationId', ParseUUIDPipe) id: string, @Meta() meta: RequestMeta) {
    return this.support.staffGet(await this.access(a), id, meta);
  }

  @Get('conversations/:conversationId/messages') @RequireAnyPlatformPermission('platform.support.inbox.read', 'platform.support.assigned.access')
  async messages(@Auth() a: AuthIdentity, @Param('conversationId', ParseUUIDPipe) id: string, @Query() q: MessagesQuery) {
    return this.support.listMessages(await this.staff(a), id, q);
  }

  @Post('conversations/:conversationId/messages') @RequirePlatformPermission('platform.support.reply') @RateLimit('support.message.user', 'user')
  async reply(@Auth() a: AuthIdentity, @Param('conversationId', ParseUUIDPipe) id: string, @Body() dto: SendMessageDto, @Meta() meta: RequestMeta) {
    return this.support.sendMessage(await this.staff(a), id, dto, meta);
  }

  @Get('conversations/:conversationId/notes') @RequirePlatformPermission('platform.support.notes')
  async notes(@Auth() a: AuthIdentity, @Param('conversationId', ParseUUIDPipe) id: string) {
    return this.support.listNotes(await this.access(a), id);
  }

  @Post('conversations/:conversationId/notes') @RequirePlatformPermission('platform.support.notes') @RateLimit('support.message.user', 'user')
  async addNote(@Auth() a: AuthIdentity, @Param('conversationId', ParseUUIDPipe) id: string, @Body() dto: NoteDto, @Meta() meta: RequestMeta) {
    return this.support.addNote(await this.access(a), id, dto, meta);
  }

  @Post('conversations/:conversationId/assignment') @HttpCode(200) @RequirePlatformPermission('platform.support.assign')
  async assign(@Auth() a: AuthIdentity, @Param('conversationId', ParseUUIDPipe) id: string, @Body() dto: AssignDto, @Meta() meta: RequestMeta) {
    return this.support.assign(await this.access(a), id, dto, meta);
  }

  @Patch('conversations/:conversationId') @RequirePlatformPermission('platform.support.status.manage')
  async update(@Auth() a: AuthIdentity, @Param('conversationId', ParseUUIDPipe) id: string, @Body() dto: UpdateConversationDto, @Meta() meta: RequestMeta) {
    return this.support.update(await this.access(a), id, dto, meta);
  }

  @Get('conversations/:conversationId/assignments') @RequireAnyPlatformPermission('platform.support.inbox.read', 'platform.support.assigned.access')
  async assignments(@Auth() a: AuthIdentity, @Param('conversationId', ParseUUIDPipe) id: string) {
    return this.support.assignmentHistory(await this.access(a), id);
  }

  @Get('conversations/:conversationId/events') @RequirePlatformPermission('platform.support.audit.read')
  async events(@Auth() a: AuthIdentity, @Param('conversationId', ParseUUIDPipe) id: string) {
    return this.support.history(await this.access(a), id);
  }

  @Post('conversations/:conversationId/read') @HttpCode(200) @RequireAnyPlatformPermission('platform.support.inbox.read', 'platform.support.assigned.access')
  async read(@Auth() a: AuthIdentity, @Param('conversationId', ParseUUIDPipe) id: string, @Body() dto: MarkReadDto) {
    return this.support.markRead(await this.staff(a), id, dto.upToSeq);
  }

  @Post('conversations/:conversationId/attachments') @RequirePlatformPermission('platform.support.reply') @RateLimit('support.upload.user', 'user')
  async upload(
    @Auth() a: AuthIdentity, @Param('conversationId', ParseUUIDPipe) id: string, @Req() req: VentidocRequest,
    @Headers('content-type') type: string | undefined, @Headers('x-file-name') name: string | undefined, @Meta() meta: RequestMeta,
  ) {
    return this.attachments.upload(await this.staff(a), id, await readUpload(req), type, name, meta);
  }

  @Get('attachments/:attachmentId/content') @RequirePlatformPermission('platform.support.attachments.read')
  async download(@Auth() a: AuthIdentity, @Param('attachmentId', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response, @Meta() meta: RequestMeta) {
    const file = await this.attachments.download(await this.staff(a), id, meta);
    attachmentHeaders(res, file.fileName, file.contentType, file.data.length);
    return new StreamableFile(file.data);
  }

  @Get('metrics') @RequirePlatformPermission('platform.support.inbox.read')
  async metrics(@Auth() a: AuthIdentity) {
    return this.support.metrics(await this.access(a));
  }

  @Get('unread') @RequireAnyPlatformPermission('platform.support.inbox.read', 'platform.support.assigned.access')
  async unread(@Auth() a: AuthIdentity) {
    return this.support.staffUnreadSummary(await this.access(a));
  }

  @Get('assignees') @RequirePlatformPermission('platform.support.assign')
  async assignees(@Auth() a: AuthIdentity) {
    return this.support.assignableStaff(await this.access(a));
  }

  /** Server-sent events for the conversations this staff member may see, re-authorized per event. */
  @Sse('stream') @RequireAnyPlatformPermission('platform.support.inbox.read', 'platform.support.assigned.access')
  stream(@Auth() a: AuthIdentity): Observable<MessageEvent> {
    return from(this.realtime.staffViewer(a.userId, a.sessionId)).pipe(
      switchMap((viewer) => {
        if (!viewer) throw Errors.forbidden();
        return this.realtime.stream(viewer);
      }),
    );
  }
}
