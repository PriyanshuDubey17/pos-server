const ApiError = require("./ApiError");

/**
 * How many base units to deduct for one sold unit of this menu item / variant.
 */
const resolveStockDeduct = (menuItem, variantName) => {
  if (!menuItem?.stockEnabled) return 0;

  const variants = Array.isArray(menuItem.variants) ? menuItem.variants : [];
  const hasVariants = variants.length > 0;

  if (hasVariants) {
    let variant = null;
    if (variantName) {
      variant = variants.find(
        (v) =>
          String(v.name || "").trim().toLowerCase() ===
          String(variantName).trim().toLowerCase(),
      );
      if (!variant) {
        throw new ApiError(
          `Variant "${variantName}" not found for ${menuItem.name}`,
          400,
        );
      }
    } else {
      variant =
        variants.find((v) => v.isDefault) ||
        variants.reduce(
          (best, v) =>
            !best || Number(v.price) < Number(best.price) ? v : best,
          null,
        );
    }

    const deduct = Number(variant?.stockDeduct);
    if (!Number.isFinite(deduct) || deduct <= 0) {
      throw new ApiError(
        `Stock deduct is not configured for ${menuItem.name}`,
        400,
      );
    }
    return deduct;
  }

  const deduct = Number(menuItem.stockDeduct);
  if (!Number.isFinite(deduct) || deduct <= 0) {
    throw new ApiError(
      `Stock deduct is not configured for ${menuItem.name}`,
      400,
    );
  }
  return deduct;
};

/** Smallest per-sale deduct — used for Low stock on Stock page */
const resolveMinStockDeduct = (menuItem) => {
  if (!menuItem?.stockEnabled) return null;
  const variants = Array.isArray(menuItem.variants) ? menuItem.variants : [];
  if (variants.length > 0) {
    const deducts = variants
      .map((v) => Number(v.stockDeduct))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (deducts.length === 0) return null;
    return Math.min(...deducts);
  }
  const deduct = Number(menuItem.stockDeduct);
  return Number.isFinite(deduct) && deduct > 0 ? deduct : null;
};

/**
 * Ensure stock fields are coherent after create/update merge.
 */
const assertMenuItemStockConfig = (item) => {
  if (!item.stockEnabled) return;

  if (item.baseUnit !== "piece" && item.baseUnit !== "gram") {
    throw new ApiError("baseUnit must be piece or gram when stock is enabled", 400);
  }

  const variants = Array.isArray(item.variants) ? item.variants : [];
  if (variants.length > 0) {
    for (const variant of variants) {
      const deduct = Number(variant.stockDeduct);
      if (!Number.isFinite(deduct) || deduct <= 0) {
        throw new ApiError(
          `Variant "${variant.name}" needs stockDeduct greater than 0`,
          400,
        );
      }
    }
  } else {
    const deduct = Number(item.stockDeduct);
    if (!Number.isFinite(deduct) || deduct <= 0) {
      throw new ApiError(
        "stockDeduct greater than 0 is required when stock is enabled without variants",
        400,
      );
    }
  }
};

module.exports = {
  resolveStockDeduct,
  resolveMinStockDeduct,
  assertMenuItemStockConfig,
};
