上传 `.xlsx` / `.xls` 文件，自动解析并展示在网页表格中，数据持久化保存到服务端 `data/data.json`。

## 快速开始

### 1. 启动服务

```bash
node server.js [端口号]
```

默认端口为 `3000`，可指定端口：

```bash
node server.js 8080
```

启动成功输出：

```
Server running at http://localhost:3000
Data file: E:\...\data\data.json
```

### 2. 打开页面

浏览器访问 `http://localhost:3000`

## 功能说明

### 导入 Excel

1. 点击 **「导入 Excel」** 按钮
2. 选择 `.xlsx` 或 `.xls` 文件
3. 自动解析并展示所有数据行

> 解析规则：自动识别表头行（内容最多的行作为表头），跳过空行和以 `#` 开头的注释行。

### 数据表格

- 直观展示所有字段列
- 支持横向滚动查看更多列
- 单元格内容过长时悬停查看完整内容

### 搜索

在工具栏搜索框输入关键词，对所有字段进行**模糊搜索**，实时过滤表格数据。

### 分页

支持每页显示 20 / 50 / 100 / 200 条记录，选择后自动记住偏好。

### 数据持久化

- **服务端模式**：导入的数据自动保存到 `data/data.json`，刷新页面或重新启动服务后自动加载
- **LocalStorage 备份**：浏览器本地也会保留一份数据作为备份
- 页面顶部绿色 **「服务端模式」** 标签表示数据来源于服务器

### 清空数据

点击 **「清空数据」** 按钮删除页面数据和 `data.json` 文件。

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/data` | 获取已保存的 JSON 数据 |
| `POST` | `/api/save` | 上传并保存 JSON 数据 |
| `DELETE` | `/api/data` | 清空数据文件 |

### POST /api/save 请求格式

```json
{
  "sheetName": "Sheet1",
  "data": [
    { "列1": "值1", "列2": "值2" }
  ]
}
```

## 目录结构

```
excelServer/
├── server.js           # 服务端入口
├── index.html          # 前端页面（Vue 3 + Element Plus）
├── data/
│   └── data.json       # 持久化数据文件
├── lib/
│   ├── vue.global.prod.js
│   ├── element-plus.umd.js
│   ├── element-plus.css
│   └── xlsx.full.min.js
└── 使用说明.md
```

## 注意事项

- 端口被占用时会输出错误提示，按提示关闭旧进程或更换端口启动
- 支持 CORS，可供其他前端页面跨域调用 API
- 数据文件为 JSON 格式，可直接用文本编辑器查看或修改
