declare module '@journeyapps/wa-sqlite/src/examples/OPFSCoopSyncVFS.js' {
  export const OPFSCoopSyncVFS: {
    create(name: string, module: unknown): Promise<SQLiteVFS>;
  };
}
