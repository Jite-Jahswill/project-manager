import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateIf,
} from 'class-validator';
import { MAX_ATTACHMENTS_PER_MESSAGE } from '../attachments';
import { SUPPORT_CATEGORIES, SUPPORT_PRIORITIES, SUPPORT_STATUSES, SupportStatus } from '../lifecycle';

type Category = (typeof SUPPORT_CATEGORIES)[number];
type Priority = (typeof SUPPORT_PRIORITIES)[number];

/** Message and note bodies: plain text, never rendered as HTML by the API. */
const BODY = { min: 1, max: 10_000 };
const CLIENT_ID = /^[A-Za-z0-9._:-]{1,100}$/;

export class CreateConversationDto {
  @ApiProperty({ maxLength: 200 }) @IsString() @MinLength(1) @MaxLength(200) @Matches(/\S/) subject!: string;
  @ApiPropertyOptional({ enum: SUPPORT_CATEGORIES }) @IsOptional() @IsIn(SUPPORT_CATEGORIES) category?: Category;
  @ApiProperty({ description: 'First message (plain text)', maxLength: BODY.max }) @IsString() @MinLength(BODY.min) @MaxLength(BODY.max) @Matches(/\S/) body!: string;
  @ApiPropertyOptional({ description: 'An organization you are an active member of (context only; grants it no access)' })
  @IsOptional() @IsUUID() organizationId?: string;
  @ApiPropertyOptional({ description: 'Idempotency key for the first message' }) @IsOptional() @Matches(CLIENT_ID) clientMessageId?: string;
}

export class SendMessageDto {
  @ApiProperty({ maxLength: BODY.max }) @IsString() @MinLength(BODY.min) @MaxLength(BODY.max) @Matches(/\S/) body!: string;
  @ApiPropertyOptional({ description: 'Idempotency key: retrying with the same key returns the original message' })
  @IsOptional() @Matches(CLIENT_ID) clientMessageId?: string;
  @ApiPropertyOptional({ type: [String], maxItems: MAX_ATTACHMENTS_PER_MESSAGE, description: 'Your own unsent uploads to this conversation' })
  @IsOptional() @IsArray() @ArrayMaxSize(MAX_ATTACHMENTS_PER_MESSAGE) @IsUUID('all', { each: true }) attachmentIds?: string[];
}

export class NoteDto {
  @ApiProperty({ maxLength: BODY.max }) @IsString() @MinLength(BODY.min) @MaxLength(BODY.max) @Matches(/\S/) body!: string;
  @ApiPropertyOptional() @IsOptional() @Matches(CLIENT_ID) clientNoteId?: string;
}

export class MarkReadDto {
  @ApiProperty({ description: 'Highest message seq the reader has seen' }) @IsInt() @Min(0) @Max(2_000_000_000) upToSeq!: number;
}

export class ListOwnQuery {
  @ApiPropertyOptional({ enum: SUPPORT_STATUSES }) @IsOptional() @IsIn(SUPPORT_STATUSES) status?: SupportStatus;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) cursor?: string;
  @ApiPropertyOptional({ maximum: 100 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

export class MessagesQuery {
  @ApiPropertyOptional({ description: 'Catch-up after a reconnect: messages with seq > afterSeq, ascending' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) afterSeq?: number;
  @ApiPropertyOptional({ description: 'Older history: messages with seq < beforeSeq' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) beforeSeq?: number;
  @ApiPropertyOptional({ maximum: 100 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

export class InboxQuery {
  @ApiPropertyOptional({ description: 'Comma-separated statuses', example: 'NEW,PENDING_SUPPORT' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.split(',').map((s) => s.trim()).filter(Boolean) : value))
  @IsArray() @ArrayMaxSize(6) @IsIn(SUPPORT_STATUSES, { each: true })
  status?: SupportStatus[];
  @ApiPropertyOptional({ enum: SUPPORT_PRIORITIES }) @IsOptional() @IsIn(SUPPORT_PRIORITIES) priority?: Priority;
  @ApiPropertyOptional({ enum: SUPPORT_CATEGORIES }) @IsOptional() @IsIn(SUPPORT_CATEGORIES) category?: Category;
  @ApiPropertyOptional({ description: '"me", "unassigned" (needs inbox.read) or a staff user id (needs inbox.read)' })
  @IsOptional() @Matches(/^(me|unassigned|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i) assignee?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() customerUserId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() organizationId?: string;
  @ApiPropertyOptional({ description: 'Reference (SUP-…) or text in the subject' }) @IsOptional() @IsString() @MaxLength(100) q?: string;
  @ApiPropertyOptional({ enum: ['lastActivity', 'created'] }) @IsOptional() @IsIn(['lastActivity', 'created']) sort?: 'lastActivity' | 'created';
  @ApiPropertyOptional({ enum: ['asc', 'desc'] }) @IsOptional() @IsIn(['asc', 'desc']) order?: 'asc' | 'desc';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) cursor?: string;
  @ApiPropertyOptional({ maximum: 100 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

export class AssignDto {
  @ApiProperty({ nullable: true, description: 'New assignee (null = back to the unassigned queue)' })
  @ValidateIf((o: AssignDto) => o.assigneeUserId !== null) @IsUUID() assigneeUserId!: string | null;
  @ApiProperty({ nullable: true, description: 'The assignee you saw (compare-and-set; null = unassigned)' })
  @ValidateIf((o: AssignDto) => o.expectedAssigneeUserId !== null) @IsUUID() expectedAssigneeUserId!: string | null;
  @ApiPropertyOptional({ maxLength: 500, description: 'Required when reassigning from one staff member to another' })
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export class UpdateConversationDto {
  @ApiProperty({ description: 'The version you saw (optimistic concurrency)' }) @IsInt() @Min(1) version!: number;
  @ApiPropertyOptional({ enum: SUPPORT_STATUSES }) @IsOptional() @IsIn(SUPPORT_STATUSES) status?: SupportStatus;
  @ApiPropertyOptional({ enum: SUPPORT_PRIORITIES }) @IsOptional() @IsIn(SUPPORT_PRIORITIES) priority?: Priority;
  @ApiPropertyOptional({ enum: SUPPORT_CATEGORIES }) @IsOptional() @IsIn(SUPPORT_CATEGORIES) category?: Category;
}
