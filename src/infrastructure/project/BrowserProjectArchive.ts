import {
  projectArchiveFilename,
  type ProjectArchivePort,
  type ProjectExportRequest,
} from "@/application/project";

export class BrowserProjectArchive implements ProjectArchivePort {
  async download(request: ProjectExportRequest): Promise<void> {
    const [{ default: JSZip }, { saveAs }] = await Promise.all([
      import("jszip"),
      import("file-saver"),
    ]);
    const archive = new JSZip();
    for (const [path, content] of Object.entries(request.files)) {
      archive.file(path, content);
    }
    saveAs(
      await archive.generateAsync({ type: "blob" }),
      projectArchiveFilename(request.title),
    );
  }
}
