---
layout: default
title: Error Handling
parent: Guides
nav_order: 1
---

# Error Handling

Proper error handling is essential when working with file conversions. This guide covers common errors and how to handle them.

## Error Types

### File Not Found

Occurs when a file path doesn't exist.

```typescript
try {
  const markdown = await convertToMarkdown('./nonexistent.pdf');
} catch (error) {
  if (error.message.includes('File not found')) {
    console.error('File does not exist');
  }
}
```

### Invalid Format

Occurs when the file format is not supported or corrupted.

```typescript
try {
  const markdown = await convertToMarkdown(buffer);
} catch (error) {
  if (error.message.includes('Failed to convert')) {
    console.error('Unable to convert this file format');
  }
}
```

### Base64 Decoding Error

Occurs when base64 data is malformed.

```typescript
try {
  const markdown = await convertToMarkdown(invalidBase64);
} catch (error) {
  if (error.message.includes('Failed to convert base64')) {
    console.error('Invalid base64 data');
  }
}
```

### Binary Word DOC Errors

DOC conversion exposes a typed error contract for controlled failures.

```typescript
import {
  convertToMarkdown,
  DocConversionError,
  type DocErrorCode,
} from '@cognipeer/to-markdown';

try {
  await convertToMarkdown(docBuffer, {
    fileName: 'policy.doc',
  });
} catch (error) {
  if (error instanceof DocConversionError) {
    const code: DocErrorCode = error.code;
    console.error(code, error.message);
  } else {
    throw error;
  }
}
```

| Code | Meaning |
| --- | --- |
| `DOC_INVALID` | The Compound File or DOC data is malformed, truncated, or has no extractable selected story. |
| `DOC_ENCRYPTED` | The file is encrypted or obfuscated. |
| `DOC_LIMIT_EXCEEDED` | An input, output, directory, piece, or list safety limit was exceeded. |
| `DOC_UNSUPPORTED` | The DOC uses a format outside the supported Word 97-2003 scope, such as Word 6/95. |

## Best Practices

### Always Use Try-Catch

Wrap conversion calls in try-catch blocks:

```typescript
async function safeConvert(input: ConverterInput): Promise<string | null> {
  try {
    return await convertToMarkdown(input);
  } catch (error) {
    console.error('Conversion failed:', error.message);
    return null;
  }
}
```

### Validate Input

Check input before conversion:

```typescript
import { existsSync } from 'fs';

function validateInput(filePath: string): boolean {
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  return true;
}

try {
  validateInput('./document.pdf');
  const markdown = await convertToMarkdown('./document.pdf');
} catch (error) {
  console.error('Validation failed:', error.message);
}
```

### Provide Helpful Context

Include context in error messages:

```typescript
async function convertWithContext(
  filePath: string,
  context: string
): Promise<string> {
  try {
    return await convertToMarkdown(filePath);
  } catch (error) {
    throw new Error(
      `Failed to convert ${context}: ${error.message}`
    );
  }
}
```

### Log Errors Appropriately

Use proper logging for production:

```typescript
import { convertToMarkdown } from '@cognipeer/to-markdown';

async function convertWithLogging(input: ConverterInput) {
  try {
    const result = await convertToMarkdown(input);
    logger.info('Conversion successful');
    return result;
  } catch (error) {
    logger.error('Conversion failed', {
      error: error.message,
      input: typeof input === 'string' ? input : 'Buffer',
      stack: error.stack
    });
    throw error;
  }
}
```

## Common Scenarios

### Batch Processing

Handle errors in batch operations:

```typescript
async function convertMultiple(files: string[]): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  
  for (const file of files) {
    try {
      const markdown = await convertToMarkdown(file);
      results.set(file, markdown);
    } catch (error) {
      console.error(`Failed to convert ${file}:`, error.message);
      // Continue with next file
    }
  }
  
  return results;
}
```

### Retry Logic

Implement retry for transient failures:

```typescript
async function convertWithRetry(
  input: ConverterInput,
  maxRetries: number = 3
): Promise<string> {
  let lastError: Error;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await convertToMarkdown(input);
    } catch (error) {
      lastError = error;
      console.warn(`Attempt ${i + 1} failed, retrying...`);
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
  
  throw new Error(
    `Failed after ${maxRetries} attempts: ${lastError.message}`
  );
}
```

### Fallback Handling

Provide fallback behavior:

```typescript
async function convertWithFallback(input: ConverterInput): Promise<string> {
  try {
    return await convertToMarkdown(input);
  } catch (error) {
    console.warn('Conversion failed, using fallback');
    
    // Return placeholder or default content
    if (Buffer.isBuffer(input)) {
      return '# Conversion Failed\n\nUnable to convert binary content.';
    } else {
      return `# Conversion Failed\n\nFile: ${input}\nError: ${error.message}`;
    }
  }
}
```

## Error Messages Reference

| Error Message | Cause | Solution |
|--------------|-------|----------|
| "File not found: ..." | File doesn't exist at path | Check file path |
| "Failed to convert base64: ..." | Invalid base64 data | Verify base64 encoding |
| "Invalid input format" | Input is neither string nor Buffer | Use correct input type |
| "Failed to convert PDF: ..." | PDF processing error | Check PDF file integrity |
| "Failed to convert DOCX: ..." | DOCX processing error | Ensure valid DOCX format |
| "Failed to convert Excel: ..." | Excel processing error | Verify Excel file format |

## See Also

- [API Overview]({{ site.baseurl }}{% link api/overview.md %})
- [Format Support]({{ site.baseurl }}{% link guides/formats.md %})
