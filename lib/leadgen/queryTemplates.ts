import { promises as fs } from "fs";
import path from "path";

const templatesDir = path.join(process.cwd(), "lead_generation_mod", "exa_payload_templates");
const templateFilePattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]*\.txt$/;
const queryFilePattern = /^([^_]+)_(.+)\.txt$/;

export type QueryTemplate = {
  fileName: string;
  vectorId: string;
  vectorName: string;
  bucket: "same_company" | "similar_company";
  requiresLinkedIn: boolean;
  content: string;
  updatedAt: string;
};

function assertTemplateFileName(fileName: string) {
  if (!templateFilePattern.test(fileName) || path.basename(fileName) !== fileName) {
    throw new Error("Query file names must be plain .txt files without folders.");
  }
  if (!queryFilePattern.test(fileName)) {
    throw new Error("Query file names must look like '<id>_<description>.txt'.");
  }
}

function templatePath(fileName: string) {
  assertTemplateFileName(fileName);
  return path.join(templatesDir, fileName);
}

function metadata(fileName: string, content: string, updatedAt: string): QueryTemplate {
  const match = fileName.match(queryFilePattern);
  const vectorId = match?.[1] || fileName.replace(/\.txt$/, "");
  const vectorName = match?.[2] || "";
  return {
    fileName,
    vectorId,
    vectorName,
    bucket: vectorName.startsWith("same_company") ? "same_company" : "similar_company",
    requiresLinkedIn: content.includes("{{linkedin_url}}"),
    content,
    updatedAt
  };
}

export async function listQueryTemplates(): Promise<QueryTemplate[]> {
  const entries = await fs.readdir(templatesDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".txt"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  return Promise.all(
    files.map(async (fileName) => {
      const filePath = templatePath(fileName);
      const [content, stat] = await Promise.all([fs.readFile(filePath, "utf8"), fs.stat(filePath)]);
      return metadata(fileName, content, stat.mtime.toISOString());
    })
  );
}

export async function saveQueryTemplate(input: { originalFileName?: string; fileName: string; content: string }) {
  const fileName = input.fileName.trim();
  const originalFileName = input.originalFileName?.trim() || fileName;
  const content = input.content.trim();

  assertTemplateFileName(fileName);
  assertTemplateFileName(originalFileName);
  if (!content) throw new Error("Query content cannot be empty.");

  const targetPath = templatePath(fileName);
  const originalPath = templatePath(originalFileName);

  if (fileName !== originalFileName) {
    try {
      await fs.access(targetPath);
      throw new Error(`A query named '${fileName}' already exists.`);
    } catch (error) {
      if (error instanceof Error && error.message.includes("already exists")) throw error;
    }
    await fs.rename(originalPath, targetPath);
  }

  await fs.writeFile(targetPath, `${content}\n`, "utf8");
}

export async function createQueryTemplate(input: { fileName: string; content: string }) {
  const fileName = input.fileName.trim();
  const content = input.content.trim();
  assertTemplateFileName(fileName);
  if (!content) throw new Error("Query content cannot be empty.");

  const filePath = templatePath(fileName);
  try {
    await fs.writeFile(filePath, `${content}\n`, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`A query named '${fileName}' already exists.`);
    }
    throw error;
  }
}

export async function deleteQueryTemplate(fileName: string) {
  await fs.unlink(templatePath(fileName));
}
