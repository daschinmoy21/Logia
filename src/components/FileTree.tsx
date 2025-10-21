<Files>
  <FolderItem value="app">
    <FolderTrigger>app</FolderTrigger>

    <FolderContent>
      <SubFiles>
        <FolderItem value="(home)">
          <FolderTrigger>(home)</FolderTrigger>

          <FolderContent>
            <FileItem>page.tsx</FileItem>
            <FileItem>layout.tsx</FileItem>
          </FolderContent>
        </FolderItem>

        <FileItem>layout.tsx</FileItem>
        <FileItem>page.tsx</FileItem>
        <FileItem>global.css</FileItem>
      </SubFiles>
    </FolderContent>
  </FolderItem>

  <FolderItem value="components">
    <FolderTrigger>components</FolderTrigger>

    <FolderContent>
      <SubFiles>
        <FileItem>button.tsx</FileItem>
        <FileItem>tabs.tsx</FileItem>
        <FileItem>dialog.tsx</FileItem>

        <FolderItem value="empty">
          <FolderTrigger>empty</FolderTrigger>
        </FolderItem>
      </SubFiles>
    </FolderContent>
  </FolderItem>

  <FileItem>package.json</FileItem>
</Files>
