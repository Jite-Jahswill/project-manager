import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/env';
import { AttachmentObjects, ObjectStores } from './attachment-objects.service';
import { AttachmentWorker } from './attachment-worker.service';
import { LocalObjectStore } from './local-object-store';
import { ClamAvScanner, MalwareScanner, NoMalwareScanner } from './malware-scanner';
import { type Backend, ObjectStore } from './object-store';
import { S3ObjectStore } from './s3-object-store';

export function createObjectStores(config: AppConfig): ObjectStores {
  const st = config.storage;
  const all = new Map<Backend, ObjectStore>();
  // The local store stays readable (legacy objects awaiting migration); it is written to only
  // when it is the configured driver, which production refuses.
  all.set('LOCAL', new LocalObjectStore(st.localDir));
  if (st.s3) all.set('S3', new S3ObjectStore(st.s3));
  return new ObjectStores(all.get(st.driver === 's3' ? 'S3' : 'LOCAL')!, all);
}

export function createMalwareScanner(config: AppConfig): MalwareScanner {
  return config.storage.clamav ? new ClamAvScanner(config.storage.clamav) : new NoMalwareScanner();
}

/** One storage, scanning and lifecycle implementation for every attachment domain (support, finance). */
@Global()
@Module({
  providers: [
    { provide: ObjectStores, inject: [APP_CONFIG], useFactory: createObjectStores },
    { provide: MalwareScanner, inject: [APP_CONFIG], useFactory: createMalwareScanner },
    AttachmentObjects,
    AttachmentWorker,
  ],
  exports: [AttachmentObjects, AttachmentWorker, ObjectStores, MalwareScanner],
})
export class StorageModule {}
