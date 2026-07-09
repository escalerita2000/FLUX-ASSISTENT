allprojects {
    repositories {
        google()
        mavenCentral()
    }
}

val newBuildDir: Directory =
    rootProject.layout.buildDirectory
        .dir("../../build")
        .get()
rootProject.layout.buildDirectory.value(newBuildDir)

subprojects {
    val newSubprojectBuildDir: Directory = newBuildDir.dir(project.name)
    project.layout.buildDirectory.value(newSubprojectBuildDir)
}
subprojects {
    project.evaluationDependsOn(":app")
}

gradle.projectsEvaluated {
    subprojects {
        val android = extensions.findByName("android") as? com.android.build.gradle.BaseExtension
        if (android != null) {
            val targetCompat = android.compileOptions.targetCompatibility
            val targetCompatStr = targetCompat.toString()
            val jvmTargetEnum = when {
                targetCompatStr.contains("1.8") -> org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_1_8
                targetCompatStr.contains("11") -> org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_11
                targetCompatStr.contains("17") -> org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
                else -> org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_1_8
            }
            tasks.withType<org.jetbrains.kotlin.gradle.tasks.KotlinCompile>().configureEach {
                compilerOptions {
                    jvmTarget.set(jvmTargetEnum)
                }
            }
        }
    }
}

tasks.register<Delete>("clean") {
    delete(rootProject.layout.buildDirectory)
}
