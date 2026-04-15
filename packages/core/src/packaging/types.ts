/**
 * SPEC-015: 打包框架型別定義
 * 上游規格: dev-platform XSPEC-034 Phase 2
 */

/** 單一打包目標宣告（來自 .devap/packaging.yaml） */
export interface PackagingTarget {
  /** Recipe 識別名稱，可為內建（如 'npm-cli'）或自訂（如 './recipes/my.yaml'） */
  recipe: string;
  /** 覆蓋 Recipe 預設 config 值（使用者優先） */
  config?: Record<string, string>;
  hooks?: {
    preBuild?: string;
    postBuild?: string;
    prePublish?: string;
    postPublish?: string;
    prePush?: string;
    postPush?: string;
  };
}

/** .devap/packaging.yaml 完整結構 */
export interface PackagingConfig {
  targets: PackagingTarget[];
}

/** Recipe 中的單一執行步驟 */
export interface RecipeStep {
  /** 要執行的 shell 命令，可含 {key} 佔位符 */
  run: string;
  description?: string;
}

/** Recipe 完整結構（對應 UDS recipes/*.yaml） */
export interface Recipe {
  /** Recipe 識別名稱（必填） */
  name: string;
  description?: string;
  /** 前置條件（檔案或工具）：執行前驗證存在性（目前僅列出，不強制檢查） */
  requires?: string[];
  /** 執行步驟（必填） */
  steps: RecipeStep[];
  /** Recipe 預設 config 值（可被使用者覆蓋） */
  config?: Record<string, string>;
  hooks?: Record<string, string | null>;
}

/** 單一 target 執行結果 */
export interface PackagingResult {
  /** 對應的 recipe 名稱 */
  target: string;
  success: boolean;
  error?: string;
  /** 執行耗時（毫秒） */
  duration: number;
}
