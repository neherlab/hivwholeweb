// Calls of the AWS CLI, shared by the upload scripts. The CLI reads the
// credentials and the region from the standard AWS environment variables.

/** Run the AWS CLI and return its standard output; fail with the CLI's error message. */
export async function aws(args: readonly string[]): Promise<string> {
  const result = await run(args);
  if (result.code !== 0) {
    throw new Error(`aws ${args.slice(0, 2).join(" ")} failed (${result.code}): ${result.stderr.trim()}`);
  }
  return result.stdout;
}

/** Run the AWS CLI and return its standard output, or `undefined` when S3 answers 404 Not Found. */
export async function awsUnlessMissing(args: readonly string[]): Promise<string | undefined> {
  const result = await run(args);
  if (result.code === 0) {
    return result.stdout;
  }
  if (/\(404\)|Not Found/u.test(result.stderr)) {
    return undefined;
  }
  throw new Error(`aws ${args.slice(0, 2).join(" ")} failed (${result.code}): ${result.stderr.trim()}`);
}

/** Clear every path from the cache of a CloudFront distribution. */
export async function invalidateAll(distribution: string): Promise<void> {
  await aws(["cloudfront", "create-invalidation", "--distribution-id", distribution, "--paths", "/*", "--output", "text", "--query", "Invalidation.Id"]);
}

/** Read a string field of a parsed JSON object, or `undefined`. */
export function stringField(value: unknown, name: string): string | undefined {
  if (typeof value !== "object" || value === null || !(name in value)) {
    return undefined;
  }
  const found: unknown = Reflect.get(value, name);
  return typeof found === "string" ? found : undefined;
}

/** Return the value of a required environment variable. */
export function requireEnv(name: string): string {
  const value = Bun.env[name];
  if (value === undefined || value === "") {
    throw new Error(`Set ${name}: see .env.example`);
  }
  return value;
}

async function run(args: readonly string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const child = Bun.spawn(["aws", ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { code, stdout, stderr };
}
