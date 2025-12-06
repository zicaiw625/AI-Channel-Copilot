/**
 * 下载工具函数
 * 用于处理 CSV 等文件的下载
 */

/**
 * 触发浏览器下载 CSV 文件
 * @param csvContent - CSV 文件内容
 * @param filename - 下载的文件名
 */
export const downloadCsv = (csvContent: string, filename: string): void => {
  if (!csvContent) {
    console.warn("[downloadCsv] Empty content provided");
    return;
  }

  // 添加 BOM 以确保 Excel 正确识别 UTF-8 编码
  const BOM = "\uFEFF";
  const blob = new Blob([BOM + csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();

  // 清理
  setTimeout(() => {
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, 100);
};

/**
 * 从 Blob 下载文件
 * @param blob - 文件 Blob
 * @param filename - 下载的文件名
 */
export const downloadBlob = (blob: Blob, filename: string): void => {
  const downloadUrl = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = downloadUrl;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  
  // 清理
  setTimeout(() => {
    document.body.removeChild(link);
    window.URL.revokeObjectURL(downloadUrl);
  }, 100);
};

/**
 * 从 API 端点下载文件（带认证）
 * @param url - API 端点 URL
 * @param fallbackFilename - 如果响应头中没有文件名时使用的备用文件名
 * @param getAuthToken - 获取认证 token 的函数
 * @returns Promise<boolean> - 下载是否成功
 */
export const downloadFromApi = async (
  url: string,
  fallbackFilename: string,
  getAuthToken: () => Promise<string>
): Promise<boolean> => {
  try {
    const token = await getAuthToken();
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Download failed with status ${response.status}`);
    }

    const blob = await response.blob();
    
    // 尝试从响应头中获取文件名
    let filename = fallbackFilename;
    const disposition = response.headers.get("content-disposition");
    if (disposition && disposition.includes("filename=")) {
      const match = disposition.match(/filename="?([^";]+)"?/);
      if (match && match[1]) {
        filename = match[1];
      }
    }

    downloadBlob(blob, filename);
    return true;
  } catch (error) {
    console.error("[downloadFromApi] Error:", error);
    return false;
  }
};

/**
 * 生成带时间戳的文件名
 * @param prefix - 文件名前缀
 * @param extension - 文件扩展名（不含点号）
 * @returns 格式化的文件名，如 "ai-orders-2024-01-15.csv"
 */
export const generateTimestampedFilename = (
  prefix: string,
  extension: string = "csv"
): string => {
  const date = new Date().toISOString().slice(0, 10);
  return `${prefix}-${date}.${extension}`;
};

/**
 * 下载 CSV 数据的便捷函数
 * @param csvContent - CSV 内容
 * @param filenamePrefix - 文件名前缀
 */
export const handleCsvDownload = (
  csvContent: string,
  filenamePrefix: string
): void => {
  const filename = generateTimestampedFilename(filenamePrefix, "csv");
  downloadCsv(csvContent, filename);
};

/**
 * 下载类型映射
 */
export type DownloadType = "orders" | "products" | "customers";

/**
 * 文件名前缀映射
 */
export const DOWNLOAD_FILENAME_PREFIXES: Record<DownloadType, string> = {
  orders: "ai-orders",
  products: "ai-top-products",
  customers: "customers-ltv",
};
