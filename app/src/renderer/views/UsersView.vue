<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { createClient } from '@electrum/client'
import type { IpcApi, UserRow } from '../ipc-api'

const api = createClient<IpcApi>()

const loading = ref(false)
const users = ref<UserRow[]>([])
const dialogVisible = ref(false)
const editingId = ref<number | null>(null)
const form = reactive({ name: '', email: '' })

async function loadUsers() {
  loading.value = true
  try {
    users.value = await api.user.list()
  } catch (err: any) {
    ElMessage.error(`${err.code || 'ERROR'}: ${err.message || err}`)
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editingId.value = null
  form.name = ''
  form.email = ''
  dialogVisible.value = true
}

function openEdit(row: UserRow) {
  editingId.value = row.id
  form.name = row.name
  form.email = row.email
  dialogVisible.value = true
}

async function submit() {
  if (!form.name.trim() || !form.email.trim()) {
    ElMessage.warning('请填写姓名与邮箱')
    return
  }
  try {
    if (editingId.value == null) {
      await api.user.create({ name: form.name.trim(), email: form.email.trim() })
      ElMessage.success('创建成功')
    } else {
      await api.user.update({
        id: editingId.value,
        name: form.name.trim(),
        email: form.email.trim(),
      })
      ElMessage.success('更新成功')
    }
    dialogVisible.value = false
    await loadUsers()
  } catch (err: any) {
    ElMessage.error(`${err.code || 'ERROR'}: ${err.message || err}`)
  }
}

async function remove(row: UserRow) {
  await ElMessageBox.confirm(`确认删除用户「${row.name}」？`, '删除确认', {
    type: 'warning',
  })
  try {
    await api.user.remove(row.id)
    ElMessage.success('已删除')
    await loadUsers()
  } catch (err: any) {
    ElMessage.error(`${err.code || 'ERROR'}: ${err.message || err}`)
  }
}

onMounted(() => {
  void loadUsers()
})
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h2>用户管理</h2>
        <p>演示 user:list / create / update / remove 与 Element Plus 表格编辑。</p>
      </div>
      <div class="actions">
        <el-button @click="loadUsers">刷新</el-button>
        <el-button type="primary" @click="openCreate">新建用户</el-button>
      </div>
    </div>

    <el-card shadow="never">
      <el-table v-loading="loading" :data="users" stripe empty-text="暂无用户">
        <el-table-column prop="id" label="ID" width="80" />
        <el-table-column prop="name" label="姓名" min-width="140" />
        <el-table-column prop="email" label="邮箱" min-width="220" />
        <el-table-column label="操作" width="180" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
            <el-button link type="danger" @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog
      v-model="dialogVisible"
      :title="editingId == null ? '新建用户' : '编辑用户'"
      width="420px"
      destroy-on-close
    >
      <el-form label-width="64px">
        <el-form-item label="姓名">
          <el-input v-model="form.name" placeholder="New User" />
        </el-form-item>
        <el-form-item label="邮箱">
          <el-input v-model="form.email" placeholder="user@example.com" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.page-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.page-head h2 {
  margin: 0 0 6px;
  font-size: 20px;
  font-weight: 650;
}

.page-head p {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
</style>
