#!/bin/bash

# 工作流辅助函数库
# 用于查找和管理工作流任务记忆

# 查找当前项目的活跃工作流
# 参数: $1 - 当前项目路径
# 返回: 工作流目录路径，如果未找到则返回空字符串
find_active_workflow() {
    local current_path="$1"
    local workflows_dir="$HOME/.claude/workflows"

    # 检查 workflows 目录是否存在
    if [ ! -d "$workflows_dir" ]; then
        return 1
    fi

    local latest_workflow=""
    local latest_updated_at=""

    # 遍历所有工作流目录
    for workflow_dir in "$workflows_dir"/*; do
        [ -d "$workflow_dir" ] || continue

        local meta_file="$workflow_dir/project-meta.json"
        [ -f "$meta_file" ] || continue

        # 读取项目路径
        local project_path=$(jq -r '.project_path' "$meta_file" 2>/dev/null)
        [ $? -eq 0 ] || continue
        [ "$project_path" = "$current_path" ] || continue

        local memory_file="$workflow_dir/workflow-memory.json"
        [ -f "$memory_file" ] || continue

        # 读取状态
        local wf_status=$(jq -r '.status' "$memory_file" 2>/dev/null)
        [ $? -eq 0 ] || continue

        # 只处理 in_progress 状态的工作流
        if [ "$wf_status" = "in_progress" ]; then
            # 获取更新时间
            local updated_at=$(jq -r '.updated_at' "$memory_file" 2>/dev/null)

            # 如果是第一个找到的工作流，或者更新时间更晚，则记录
            if [ -z "$latest_workflow" ] || [ "$updated_at" \> "$latest_updated_at" ]; then
                latest_workflow="$workflow_dir"
                latest_updated_at="$updated_at"
            fi
        fi
    done

    if [ -n "$latest_workflow" ]; then
        echo "$latest_workflow"
        return 0
    fi

    return 1
}

# 获取工作流记忆文件路径
# 参数: $1 - 工作流目录
# 返回: workflow-memory.json 文件路径
get_workflow_memory_path() {
    local workflow_dir="$1"
    echo "$workflow_dir/workflow-memory.json"
}

# 获取项目元信息文件路径
# 参数: $1 - 工作流目录
# 返回: project-meta.json 文件路径
get_project_meta_path() {
    local workflow_dir="$1"
    echo "$workflow_dir/project-meta.json"
}

# 生成新的 project_id
# 返回: 12位随机十六进制字符串
generate_project_id() {
    head -c 6 /dev/urandom | xxd -p
}

# 列出当前项目的所有工作流
# 参数: $1 - 当前项目路径
# 输出: 工作流列表（JSON 格式）
list_project_workflows() {
    local current_path="$1"
    local workflows_dir="$HOME/.claude/workflows"

    if [ ! -d "$workflows_dir" ]; then
        echo "[]"
        return 0
    fi

    local workflows="[]"

    for workflow_dir in "$workflows_dir"/*; do
        [ -d "$workflow_dir" ] || continue

        local meta_file="$workflow_dir/project-meta.json"
        [ -f "$meta_file" ] || continue

        local project_path=$(jq -r '.project_path' "$meta_file" 2>/dev/null)
        [ $? -eq 0 ] || continue
        [ "$project_path" = "$current_path" ] || continue

        local memory_file="$workflow_dir/workflow-memory.json"
        [ -f "$memory_file" ] || continue

        local wf_status=$(jq -r '.status' "$memory_file" 2>/dev/null)
        local task_name=$(jq -r '.task_name' "$memory_file" 2>/dev/null)
        local updated_at=$(jq -r '.updated_at' "$memory_file" 2>/dev/null)
        local current_step=$(jq -r '.current_step_id' "$memory_file" 2>/dev/null)
        local total_steps=$(jq -r '.total_steps' "$memory_file" 2>/dev/null)

        workflows=$(echo "$workflows" | jq --arg dir "$workflow_dir" \
            --arg status "$wf_status" \
            --arg name "$task_name" \
            --arg updated "$updated_at" \
            --argjson current "$current_step" \
            --argjson total "$total_steps" \
            '. += [{"dir": $dir, "status": $status, "task_name": $name, "updated_at": $updated, "current_step": $current, "total_steps": $total}]')
    done

    echo "$workflows"
}

# 导出函数供其他脚本使用
export -f find_active_workflow
export -f get_workflow_memory_path
export -f get_project_meta_path
export -f generate_project_id
export -f list_project_workflows
