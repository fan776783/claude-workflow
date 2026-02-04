#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "pillow>=10.0.0",
#     "numpy>=1.24.0",
# ]
# ///
"""
图片差异对比工具

功能：
1. 加载设计稿和实现截图
2. 尺寸对齐
3. 生成叠加图（半透明叠加）
4. 生成差异图（像素差异高亮）
5. 计算差异百分比

用法（推荐 uvx）：
  uvx image_diff.py <design.png> <impl.png> --output <output_dir>
  uvx image_diff.py design.png impl.png -o ./diff-output --threshold 30

或手动安装依赖：
  pip install pillow numpy
  python image_diff.py ...
"""

import argparse
import json
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter
import numpy as np


def load_and_align(design_path: str, impl_path: str) -> tuple[Image.Image, Image.Image]:
    """加载图片并对齐尺寸"""
    design = Image.open(design_path).convert('RGBA')
    impl = Image.open(impl_path).convert('RGBA')

    # 以设计稿尺寸为基准
    if design.size != impl.size:
        impl = impl.resize(design.size, Image.Resampling.LANCZOS)

    return design, impl


def create_overlay(design: Image.Image, impl: Image.Image, opacity: float = 0.5) -> Image.Image:
    """创建半透明叠加图"""
    # 设计稿作为底层
    overlay = design.copy()

    # 实现截图半透明叠加
    impl_with_alpha = impl.copy()
    impl_with_alpha.putalpha(int(255 * opacity))

    overlay = Image.alpha_composite(overlay, impl_with_alpha)
    return overlay


def create_diff_highlight(design: Image.Image, impl: Image.Image, threshold: int = 30) -> tuple[Image.Image, float]:
    """创建差异高亮图，返回差异图和差异百分比"""
    # 转换为 numpy 数组
    design_arr = np.array(design.convert('RGB'), dtype=np.float32)
    impl_arr = np.array(impl.convert('RGB'), dtype=np.float32)

    # 计算像素差异
    diff = np.abs(design_arr - impl_arr)
    diff_gray = np.mean(diff, axis=2)

    # 创建差异掩码
    mask = diff_gray > threshold

    # 计算差异百分比
    diff_percentage = (np.sum(mask) / mask.size) * 100

    # 创建差异高亮图
    result = impl.copy().convert('RGBA')
    highlight = Image.new('RGBA', result.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(highlight)

    # 将差异区域标记为红色
    mask_img = Image.fromarray((mask * 255).astype(np.uint8))
    # 膨胀差异区域使其更明显
    mask_img = mask_img.filter(ImageFilter.MaxFilter(3))

    # 创建红色高亮层
    red_layer = Image.new('RGBA', result.size, (255, 0, 0, 128))
    result.paste(red_layer, mask=mask_img)

    return result, diff_percentage


def create_side_by_side(design: Image.Image, impl: Image.Image, diff: Image.Image) -> Image.Image:
    """创建并排对比图"""
    width = design.width
    height = design.height

    # 创建 3 列并排图
    combined = Image.new('RGBA', (width * 3 + 20, height + 40), (30, 30, 30, 255))

    # 添加标签
    draw = ImageDraw.Draw(combined)

    # 粘贴图片
    combined.paste(design, (0, 40))
    combined.paste(impl, (width + 10, 40))
    combined.paste(diff, (width * 2 + 20, 40))

    # 添加标签文字（简单方式）
    draw.rectangle([(0, 0), (width, 35)], fill=(50, 50, 50))
    draw.rectangle([(width + 10, 0), (width * 2 + 10, 35)], fill=(50, 50, 50))
    draw.rectangle([(width * 2 + 20, 0), (width * 3 + 20, 35)], fill=(50, 50, 50))

    return combined


def analyze_diff_regions(design: Image.Image, impl: Image.Image, threshold: int = 30) -> list[dict]:
    """分析差异区域，返回差异详情"""
    design_arr = np.array(design.convert('RGB'), dtype=np.float32)
    impl_arr = np.array(impl.convert('RGB'), dtype=np.float32)

    diff = np.abs(design_arr - impl_arr)
    diff_gray = np.mean(diff, axis=2)

    # 找出差异区域
    regions = []

    # 分块分析（将图片分成 4x4 网格）
    h, w = diff_gray.shape
    block_h, block_w = h // 4, w // 4

    for i in range(4):
        for j in range(4):
            block = diff_gray[i*block_h:(i+1)*block_h, j*block_w:(j+1)*block_w]
            block_diff = np.mean(block > threshold) * 100

            if block_diff > 5:  # 超过 5% 差异才记录
                regions.append({
                    "position": f"row{i+1}_col{j+1}",
                    "x": j * block_w,
                    "y": i * block_h,
                    "width": block_w,
                    "height": block_h,
                    "diff_percentage": round(block_diff, 2)
                })

    return sorted(regions, key=lambda x: x["diff_percentage"], reverse=True)


def main():
    parser = argparse.ArgumentParser(description='图片差异对比工具')
    parser.add_argument('design', help='设计稿图片路径')
    parser.add_argument('impl', help='实现截图路径')
    parser.add_argument('-o', '--output', default='./diff-output', help='输出目录')
    parser.add_argument('-t', '--threshold', type=int, default=30, help='差异阈值 (0-255)')
    parser.add_argument('--json', action='store_true', help='输出 JSON 格式报告')

    args = parser.parse_args()

    # 创建输出目录
    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    # 加载并对齐图片
    print(f"Loading images...")
    design, impl = load_and_align(args.design, args.impl)

    # 生成叠加图
    print(f"Creating overlay...")
    overlay = create_overlay(design, impl)
    overlay_path = output_dir / 'overlay.png'
    overlay.save(overlay_path)

    # 生成差异高亮图
    print(f"Creating diff highlight...")
    diff_highlight, diff_percentage = create_diff_highlight(design, impl, args.threshold)
    diff_path = output_dir / 'diff_highlight.png'
    diff_highlight.save(diff_path)

    # 生成并排对比图
    print(f"Creating side-by-side comparison...")
    side_by_side = create_side_by_side(design, impl, diff_highlight)
    comparison_path = output_dir / 'comparison.png'
    side_by_side.save(comparison_path)

    # 分析差异区域
    print(f"Analyzing diff regions...")
    regions = analyze_diff_regions(design, impl, args.threshold)

    # 生成报告
    report = {
        "design_size": {"width": design.width, "height": design.height},
        "impl_size": {"width": impl.width, "height": impl.height},
        "threshold": args.threshold,
        "overall_diff_percentage": round(diff_percentage, 2),
        "diff_regions": regions,
        "outputs": {
            "overlay": str(overlay_path),
            "diff_highlight": str(diff_path),
            "comparison": str(comparison_path)
        },
        "verdict": "PASS" if diff_percentage < 5 else ("REVIEW" if diff_percentage < 15 else "FAIL")
    }

    # 输出报告
    report_path = output_dir / 'report.json'
    with open(report_path, 'w', encoding='utf-8') as f:
        json.dump(report, f, indent=2, ensure_ascii=False)

    if args.json:
        print(json.dumps(report, indent=2, ensure_ascii=False))
    else:
        print(f"\n{'='*50}")
        print(f"差异分析报告")
        print(f"{'='*50}")
        print(f"设计稿尺寸: {design.width}x{design.height}")
        print(f"实现尺寸:   {impl.width}x{impl.height}")
        print(f"差异阈值:   {args.threshold}")
        print(f"总体差异:   {diff_percentage:.2f}%")
        print(f"判定结果:   {report['verdict']}")
        print(f"\n输出文件:")
        print(f"  - 叠加图:   {overlay_path}")
        print(f"  - 差异图:   {diff_path}")
        print(f"  - 对比图:   {comparison_path}")
        print(f"  - 报告:     {report_path}")

        if regions:
            print(f"\n差异区域 (Top 5):")
            for r in regions[:5]:
                print(f"  - {r['position']}: {r['diff_percentage']:.1f}%")

    # 返回退出码
    sys.exit(0 if report['verdict'] == 'PASS' else 1)


if __name__ == '__main__':
    main()
